from pathlib import Path
import json
import re
from urllib.request import ProxyHandler, Request, build_opener

from playwright.sync_api import Route, expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
API_BASE_URL = 'http://127.0.0.1:8788'
APPROVAL_SCREENSHOT = Path('/tmp/outbound-platform-stage6b2-approval.png')
AUDIT_SCREENSHOT = Path('/tmp/outbound-platform-stage6b2-audit.png')


def api_json(path: str) -> dict:
    opener = build_opener(ProxyHandler({}))
    request = Request(
        f'{API_BASE_URL}{path}',
        headers={'x-actor-id': 'stage6b2-ui-verifier'},
    )
    with opener.open(request, timeout=10) as response:
        return json.load(response)['data']


def load_fixtures() -> tuple[dict, dict]:
    studios = api_json('/api/v1/studios?pageNum=0&pageSize=100')['studios']
    audit_events = api_json('/api/v1/audit-logs?pageNum=0&pageSize=20')['items']
    if not studios:
        raise AssertionError('Stage 6B-2 UI verification needs at least one studio')
    if not audit_events:
        raise AssertionError('Stage 6B-2 UI verification needs at least one audit event')
    return studios[0], audit_events[0]


def fake_adjustment(studio: dict) -> dict:
    return {
        'id': '9c26fa02-7854-4ef6-95f2-38c09d36f294',
        'requestNo': 'AR-20260906-90001',
        'studioId': studio['id'],
        'studioBusinessCode': studio['businessCode'],
        'studioName': studio['name'],
        'kind': 'REFUND',
        'amount': '88.000000',
        'balanceChange': '-88.000000',
        'balanceSnapshot': studio['account']['balance'],
        'availableBalanceSnapshot': studio['account']['availableBalance'],
        'currentBalance': studio['account']['balance'],
        'currentAvailableBalance': studio['account']['availableBalance'],
        'currentAccountStatus': studio['account']['status'],
        'reason': '阶段 6B-2 浏览器只读验收样例',
        'supportingReference': 'REF-UI-VERIFY-001',
        'status': 'PENDING',
        'requestedBy': 'finance-maker',
        'requestedAt': '2026-09-06T01:30:00.000Z',
        'reviewedBy': None,
        'reviewNote': None,
        'reviewedAt': None,
        'ledger': None,
        'canReview': True,
        'lockVersion': 0,
    }


def install_adjustment_fixture(page, studio: dict) -> None:
    item = fake_adjustment(studio)

    def handle(route: Route) -> None:
        if route.request.method != 'GET':
            route.continue_()
            return
        payload = {
            'requestId': 'stage6b2-browser-fixture',
            'data': {
                'total': 1,
                'pages': 1,
                'pageNum': 0,
                'pageSize': 20,
                'summary': {
                    'all': 1,
                    'pending': 1,
                    'approved': 0,
                    'rejected': 0,
                    'pendingCreditAmount': '0.000000',
                    'pendingDebitAmount': '88.000000',
                },
                'items': [item],
            },
        }
        route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps(payload),
        )

    page.route(re.compile(r'.*/api/v1/account-adjustments\?.*'), handle)


def main() -> None:
    studio, audit_event = load_fixtures()
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        install_adjustment_fixture(page, studio)
        page.goto(APP_URL, wait_until='networkidle')

        page.get_by_role('button', name=re.compile(r'^充值记录')).click()
        expect(page.get_by_text('退款与人工调整审批', exact=True)).to_be_visible()
        expect(page.get_by_text('双人分离，批准后才记账', exact=True)).to_be_visible()
        adjustment_row = page.locator('tr', has_text='AR-20260906-90001')
        expect(adjustment_row.get_by_text(studio['name'], exact=True)).to_be_visible()
        expect(adjustment_row.get_by_text('可由你复核', exact=True)).to_be_visible()
        adjustment_row.get_by_role('button', name='复核').click()

        review_dialog = page.get_by_role('dialog')
        expect(review_dialog.get_by_text('复核资金申请', exact=True)).to_be_visible()
        expect(review_dialog.get_by_text('申请时可用', exact=True)).to_be_visible()
        expect(review_dialog.get_by_text('当前可用', exact=True)).to_be_visible()
        review_dialog.get_by_placeholder('说明批准或拒绝依据').fill(
            '由独立复核人确认业务依据'
        )
        expect(review_dialog.get_by_role('button', name='拒绝申请')).to_be_enabled()
        expect(review_dialog.get_by_role('button', name='批准并记账')).to_be_enabled()
        page.screenshot(path=str(APPROVAL_SCREENSHOT), full_page=True)
        review_dialog.get_by_role('button', name='关闭').click()
        expect(review_dialog).not_to_be_visible()

        page.get_by_role('button', name='发起退款 / 调整').click()
        create_dialog = page.get_by_role('dialog')
        expect(create_dialog.get_by_text('发起退款或人工调整', exact=True)).to_be_visible()
        expect(
            create_dialog.get_by_text(
                re.compile(r'仅负责申请，不能批准自己的申请')
            )
        ).to_be_visible()
        expect(create_dialog.get_by_role('button', name='提交给他人复核')).to_be_disabled()
        create_dialog.get_by_role('button', name='取消').click()

        page.get_by_role('button', name=re.compile(r'^操作日志')).click()
        expect(page.get_by_text('真实审计事件', exact=True)).to_be_visible()
        expect(page.get_by_text('审计记录只追加', exact=False)).to_be_visible()
        audit_row = (
            page.locator('tbody tr')
            .filter(has_text=audit_event['actorId'])
            .filter(has_text=audit_event['actionLabel'])
            .first
        )
        expect(audit_row).to_contain_text(audit_event['actorId'])
        expect(audit_row).to_contain_text(audit_event['actionLabel'])
        audit_button = audit_row.get_by_role(
            'button', name=f"查看 {audit_event['actionLabel']} 审计详情"
        )
        audit_button.click()

        audit_dialog = page.get_by_role('dialog')
        expect(audit_dialog.get_by_text(audit_event['actionLabel'], exact=True)).to_be_visible()
        expect(audit_dialog.get_by_text('服务端脱敏详情', exact=True)).to_be_visible()
        expect(audit_dialog.get_by_text(audit_event['requestId'], exact=True)).to_be_visible()
        page.screenshot(path=str(AUDIT_SCREENSHOT), full_page=True)
        audit_dialog.get_by_role('button', name='关闭详情').click()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        install_adjustment_fixture(mobile, studio)
        mobile.goto(APP_URL, wait_until='networkidle')
        mobile.get_by_role('button', name=re.compile(r'^充值记录')).click()
        expect(mobile.get_by_text('退款与人工调整审批', exact=True)).to_be_visible()
        expect(mobile.get_by_text('双人分离，批准后才记账', exact=True)).to_be_visible()
        document_width = mobile.evaluate('document.documentElement.scrollWidth')
        viewport_width = mobile.evaluate('window.innerWidth')
        if document_width > viewport_width + 1:
            raise AssertionError(
                f'Mobile page overflows horizontally: {document_width}px > {viewport_width}px'
            )
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Stage 6B-2 UI verification passed '
        '(read-only approval fixture + real audit + mobile layout)'
    )
    print(f'Approval screenshot: {APPROVAL_SCREENSHOT}')
    print(f'Audit screenshot: {AUDIT_SCREENSHOT}')


if __name__ == '__main__':
    main()
