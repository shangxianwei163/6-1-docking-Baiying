from pathlib import Path
import json
import re
import uuid

from playwright.sync_api import Route, expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
SETTLEMENT_MONTH = '2026-08'
EMPTY_SETTLEMENT_MONTH = '2026-07'
SOURCE_HASH = 'a' * 64
SETTLEMENT_ID = 'd0a67a1e-6822-4cad-a1a6-8c63891570f7'
SCREENSHOT = Path('/tmp/outbound-platform-stage7b-settlement.png')
EMPTY_SCREENSHOT = Path('/tmp/outbound-platform-stage7b-empty-settlement.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-stage7b-settlement-mobile.png')


def settlement_summary(finalized: bool) -> dict:
    return {
        'settlementId': SETTLEMENT_ID if finalized else None,
        'settlementMonth': SETTLEMENT_MONTH,
        'timezone': 'Asia/Shanghai',
        'periodStart': '2026-07-31T16:00:00.000Z',
        'periodEnd': '2026-08-31T16:00:00.000Z',
        'status': 'FINALIZED' if finalized else 'OPEN',
        'taskCount': 12,
        'totalBillingMinutes': '10000',
        'tier': {
            'id': '578e40c9-c21d-42ad-99be-bb870cd78faf',
            'tierCode': 'GROWTH',
            'name': '成长阶梯',
            'minMonthlyMinutes': '10000',
            'maxMonthlyMinutes': '50000',
            'voiceRate': '0.180000',
        },
        'totalCustomerCharge': '4800.000000',
        'totalPlatformCost': '1800.000000',
        'totalProfit': '3000.000000',
        'sourceHash': SOURCE_HASH,
        'reconciliation': {
            'status': 'BALANCED',
            'discrepancyCount': 0,
            'blockingTaskCount': 0,
            'lateTaskCount': 0,
            'issues': [],
            'issuesTruncated': False,
        },
        'finalizedBy': 'stage7b-ui-verifier' if finalized else None,
        'finalizedAt': '2026-09-06T08:30:00.000Z' if finalized else None,
        'idempotentReplay': False,
    }


def empty_settlement_summary() -> dict:
    return {
        'settlementId': None,
        'settlementMonth': EMPTY_SETTLEMENT_MONTH,
        'timezone': 'Asia/Shanghai',
        'periodStart': '2026-06-30T16:00:00.000Z',
        'periodEnd': '2026-07-31T16:00:00.000Z',
        'status': 'OPEN',
        'taskCount': 0,
        'totalBillingMinutes': '0',
        'tier': None,
        'totalCustomerCharge': '0.000000',
        'totalPlatformCost': '0.000000',
        'totalProfit': '0.000000',
        'sourceHash': 'b' * 64,
        'reconciliation': {
            'status': 'BALANCED',
            'discrepancyCount': 0,
            'blockingTaskCount': 0,
            'lateTaskCount': 0,
            'issues': [],
            'issuesTruncated': False,
        },
        'finalizedBy': None,
        'finalizedAt': None,
        'idempotentReplay': False,
    }


def install_settlement_fixture(page, finalize_requests: list[dict]) -> None:
    def handle(route: Route) -> None:
        request = route.request
        if (
            request.method == 'GET'
            and f'/{EMPTY_SETTLEMENT_MONTH}/' in request.url
            and request.url.endswith('/preview')
        ):
            data = empty_settlement_summary()
            status = 200
        elif request.method == 'GET' and request.url.endswith('/preview'):
            data = settlement_summary(False)
            status = 200
        elif request.method == 'POST' and request.url.endswith('/finalize'):
            finalize_requests.append(request.post_data_json)
            data = settlement_summary(True)
            status = 201
        else:
            route.continue_()
            return
        route.fulfill(
            status=status,
            content_type='application/json',
            body=json.dumps({'requestId': 'stage7b-browser-fixture', 'data': data}),
        )

    page.route(
        re.compile(
            rf'.*/api/v1/supplier-settlements/(?:{SETTLEMENT_MONTH}|{EMPTY_SETTLEMENT_MONTH})/(?:preview|finalize)$'
        ),
        handle,
    )


def open_settlement(page) -> None:
    page.goto(APP_URL, wait_until='networkidle')
    page.get_by_role('button', name=re.compile(r'^话费设置')).click()
    studio_tab = page.get_by_role('tab', name=re.compile(r'^影楼话费'))
    hainan_tab = page.get_by_role('tab', name=re.compile(r'^海南人像话费'))
    expect(studio_tab).to_have_attribute('aria-selected', 'true')
    expect(page.get_by_text('发布客户价格版本', exact=True)).to_be_visible()
    expect(page.get_by_text('供应商月度结算', exact=True)).not_to_be_visible()
    hainan_tab.click()
    expect(hainan_tab).to_have_attribute('aria-selected', 'true')
    expect(page.get_by_text('供应商月度结算', exact=True)).to_be_visible()
    select_settlement_month(page, SETTLEMENT_MONTH)
    panel = page.locator('.ops-settlement-panel')
    expect(panel.get_by_text('账务平衡', exact=True)).to_be_visible()


def select_settlement_month(page, value: str) -> None:
    year, month = value.split('-')
    trigger = page.get_by_label('供应商结算月份')
    expected_label = f'{year} 年 {month} 月'
    if trigger.inner_text().strip() == expected_label:
        return
    trigger.click()
    picker = page.locator('.unified-month-picker')
    while picker.locator('.unified-month-nav b').inner_text().strip() != f'{year} 年':
        visible_year = int(
            picker.locator('.unified-month-nav b').inner_text().split()[0]
        )
        direction = '上一年' if visible_year > int(year) else '下一年'
        picker.get_by_role('button', name=direction).click()
    picker.get_by_role('button', name=f'{int(month)} 月', exact=True).click()


def main() -> None:
    page_errors: list[str] = []
    finalize_requests: list[dict] = []
    unexpected_network: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))

        def observe_request(request) -> None:
            if request.resource_type in {'xhr', 'fetch'} and not re.match(
                r'^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?/', request.url
            ):
                unexpected_network.append(request.url)

        page.on('request', observe_request)
        install_settlement_fixture(page, finalize_requests)
        open_settlement(page)

        panel = page.locator('.ops-settlement-panel')
        expect(panel.get_by_text('待封账', exact=True)).to_be_visible()
        expect(panel.get_by_text('¥4,800.00', exact=True)).to_be_visible()
        expect(panel.get_by_text('¥1,800.00', exact=True)).to_be_visible()
        expect(panel.get_by_text('¥3,000.00', exact=True)).to_be_visible()
        expect(panel.get_by_text('成长阶梯 · ¥0.18/分', exact=True)).to_be_visible()
        expect(panel.get_by_role('button', name='核对并封账')).to_be_enabled()
        panel.get_by_role('button', name='核对并封账').click()

        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_text(f'确认封账 {SETTLEMENT_MONTH}', exact=True)).to_be_visible()
        expect(dialog.get_by_text('封账结果不可编辑或覆盖', exact=True)).to_be_visible()
        expect(dialog.get_by_text(SOURCE_HASH, exact=True)).to_be_visible()
        assert_dialog_has_no_outer_overflow(page, dialog, 'Settlement dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_outer_overflow(
            page, dialog, 'Settlement dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        dialog.get_by_role('button', name='确认不可逆封账').click()

        expect(panel.get_by_text('已封账', exact=True)).to_be_visible()
        expect(
            panel.get_by_text(
                f'{SETTLEMENT_MONTH} 供应商成本已封账，12 个任务已锁定最终成本与利润。',
                exact=True,
            )
        ).to_be_visible()
        expect(panel.get_by_text(re.compile(SETTLEMENT_ID))).to_be_visible()
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        select_settlement_month(page, EMPTY_SETTLEMENT_MONTH)
        expect(panel.get_by_text('无需封账', exact=True)).to_be_visible()
        expect(panel.get_by_text('本月无结算任务', exact=True)).to_be_visible()
        expect(
            panel.get_by_text(
                '该月份没有已结算任务，无需配置供应阶梯，也无需生成供应商月结单。',
                exact=True,
            )
        ).to_be_visible()
        expect(panel.get_by_text('存在封账阻断项', exact=True)).not_to_be_visible()
        expect(panel.get_by_text('供应阶梯缺失', exact=True)).not_to_be_visible()
        expect(panel.get_by_role('button', name='核对并封账')).not_to_be_visible()
        expect(panel.get_by_text('无需生成结算凭证', exact=True)).to_be_visible()
        page.screenshot(path=str(EMPTY_SCREENSHOT), full_page=True)

        if len(finalize_requests) != 1:
            raise AssertionError(
                f'Expected one finalize request, got {len(finalize_requests)}'
            )
        request = finalize_requests[0]
        if set(request) != {'expectedSourceHash', 'reason', 'idempotencyKey'}:
            raise AssertionError(f'Unexpected finalize request: {json.dumps(request)}')
        if request['expectedSourceHash'] != SOURCE_HASH:
            raise AssertionError('Finalize request did not preserve the preview source hash')
        uuid.UUID(request['idempotencyKey'])

        mobile_requests: list[dict] = []
        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        install_settlement_fixture(mobile, mobile_requests)
        open_settlement(mobile)
        expect(
            mobile.locator('.ops-settlement-panel').get_by_role(
                'button', name='核对并封账'
            )
        ).to_be_enabled()
        document_width = mobile.evaluate('document.documentElement.scrollWidth')
        viewport_width = mobile.evaluate('window.innerWidth')
        if document_width > viewport_width + 1:
            raise AssertionError(
                f'Mobile page overflows horizontally: {document_width}px > {viewport_width}px'
            )
        mobile.screenshot(path=str(MOBILE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    if unexpected_network:
        raise AssertionError(f'Unexpected external browser requests: {unexpected_network}')
    print(
        'Stage 7B UI verification passed '
        '(preview + empty month + immutable confirmation + request contract + finalized state + mobile layout)'
    )
    print(f'Settlement screenshot: {SCREENSHOT}')
    print(f'Empty month screenshot: {EMPTY_SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
