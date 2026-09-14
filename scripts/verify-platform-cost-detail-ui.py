from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import re

from playwright.sync_api import Route, expect, sync_playwright

from ui_auth import open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCREENSHOT = Path('/tmp/outbound-platform-cost-detail.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-cost-detail-mobile.png')
RANGE_SCREENSHOT = Path('/tmp/outbound-platform-cost-detail-range.png')


ITEMS = [
    {
        'taskId': '11111111-1111-4111-8111-111111111111',
        'taskNo': 'PT-20260911-00001',
        'studioId': '22222222-2222-4222-8222-222222222222',
        'studioBusinessCode': 'ST-000061',
        'studioName': '门牌第6+1摄影',
        'sourceSystem': 'ERP',
        'taskName': '20260911排档孕妈-00001',
        'baiyingCallJobId': '3891608250699',
        'occurredAt': '2026-09-11T02:39:18.000Z',
        'settlementMonth': '2026-09',
        'phoneCount': 1,
        'billingMinutes': 2,
        'monthlyBillingMinutes': '305200',
        'customerRate': '0.480000',
        'customerCharge': '0.960000',
        'platformRate': '0.180000',
        'platformCost': '0.360000',
        'profit': '0.600000',
        'costStatus': 'PROVISIONAL',
        'tierCode': 'tier-3',
        'tierName': '海南人像 tier-3',
        'relatedSettlementId': None,
        'finalizedAt': None,
    },
    {
        'taskId': '33333333-3333-4333-8333-333333333333',
        'taskNo': 'PT-20260910-00001',
        'studioId': '44444444-4444-4444-8444-444444444444',
        'studioBusinessCode': 'ST-000088',
        'studioName': '海口样片中心',
        'sourceSystem': 'CRM',
        'taskName': '20260910婚纱邀约-00001',
        'baiyingCallJobId': '3891608250601',
        'occurredAt': '2026-09-10T07:30:25.000Z',
        'settlementMonth': '2026-09',
        'phoneCount': 3,
        'billingMinutes': 5,
        'monthlyBillingMinutes': '305200',
        'customerRate': '0.480000',
        'customerCharge': '2.400000',
        'platformRate': '0.180000',
        'platformCost': '0.900000',
        'profit': '1.500000',
        'costStatus': 'FINAL',
        'tierCode': 'tier-3',
        'tierName': '海南人像 tier-3',
        'relatedSettlementId': '55555555-5555-4555-8555-555555555555',
        'finalizedAt': '2026-09-30T16:10:00.000Z',
    },
]


def install_fixture(page, observed_queries: list[dict]) -> None:
    def handle(route: Route) -> None:
        request = route.request
        parsed = urlparse(request.url)
        query = parse_qs(parsed.query)
        observed_queries.append(query)
        if parsed.path.endswith('/export'):
            route.fulfill(
                status=200,
                headers={
                    'content-type': 'text/csv; charset=utf-8',
                    'content-disposition': (
                        "attachment; filename=\"platform-cost-details.csv\"; "
                        "filename*=UTF-8''%E5%B9%B3%E5%8F%B0%E6%98%8E%E7%BB%86_2026-09-01_2026-09-14.csv"
                    ),
                    'x-export-row-count': '2',
                    'access-control-expose-headers': (
                        'Content-Disposition, X-Export-Row-Count'
                    ),
                },
                body='\ufeff"任务编号","百应供应成本"\r\n"PT-20260911-00001","0.360000"',
            )
            return

        requested_status = query.get('costStatus', [None])[0]
        items = [
            item for item in ITEMS
            if requested_status is None or item['costStatus'] == requested_status
        ]
        status_counts = {
            'all': 2,
            'provisional': 1,
            'final': 1,
            'adjustmentPending': 0,
            'unavailable': 0,
        }
        data = {
            'total': len(items),
            'pages': 1 if items else 0,
            'pageNum': 0,
            'pageSize': int(query.get('pageSize', ['20'])[0]),
            'summary': {
                'taskCount': len(items),
                'totalBillingMinutes': str(sum(item['billingMinutes'] for item in items)),
                'totalCustomerCharge': f"{sum(float(item['customerCharge']) for item in items):.6f}",
                'totalPlatformCost': f"{sum(float(item['platformCost']) for item in items):.6f}",
                'totalProfit': f"{sum(float(item['profit']) for item in items):.6f}",
                'unpricedBillingMinutes': '0',
                'statusCounts': status_counts,
            },
            'items': items,
        }
        route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps({'requestId': 'platform-detail-ui-test', 'data': data}),
        )

    page.route(re.compile(r'.*/api/v1/platform-cost-details(?:/export)?(?:\?.*)?$'), handle)


def open_platform_details(page) -> None:
    open_authenticated(page)
    nav = page.get_by_role('navigation', name='平台功能菜单')
    detail = nav.get_by_role('button', name='平台明细', exact=True)
    if not detail.count() or not detail.first.is_visible():
        nav.get_by_role('button', name='财务管理', exact=True).click()
        detail = nav.get_by_role('button', name='平台明细', exact=True)
    detail.click()
    expect(page.get_by_role('heading', name='平台明细', exact=True)).to_be_visible()
    expect(page.get_by_text('平台与百应费用明细', exact=True)).to_be_visible()


def main() -> None:
    page_errors: list[str] = []
    observed_queries: list[dict] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        install_fixture(page, observed_queries)
        open_platform_details(page)

        expect(page.get_by_text('PT-20260911-00001', exact=True)).to_be_visible()
        expect(page.get_by_text('海南人像 tier-3', exact=True).first).to_be_visible()
        expect(page.get_by_text('动态暂估', exact=True).last).to_be_visible()
        expect(page.get_by_text('¥1.26', exact=True)).to_be_visible()
        expect(page.get_by_text('¥2.10', exact=True)).to_be_visible()

        date_range = page.get_by_role('button', name='平台明细费用日期范围')
        expect(date_range).to_have_count(1)
        expect(date_range).to_contain_text('2026/09/01 — 2026/09/14')
        date_range.click()
        expect(page.locator('.unified-date-popup-label')).to_contain_text(
            '选择费用日期范围'
        )
        page.get_by_role('button', name='清除', exact=True).click()
        date_range.click()
        expect(page.get_by_text('支持跨月选择', exact=True)).to_be_visible()
        september = page.get_by_role('grid', name='九月 2026')
        october = page.get_by_role('grid', name='十月 2026')
        expect(october).to_be_visible()
        page.screenshot(path=str(RANGE_SCREENSHOT), full_page=True)
        september.locator('[data-day="2026/9/28"]').click()
        october.locator('[data-day="2026/10/3"]').click()
        page.get_by_role('button', name='确认范围', exact=True).click()
        expect(date_range).to_contain_text('2026/09/28 — 2026/10/03')
        page.get_by_role('button', name='本月', exact=True).click()
        expect(date_range).to_contain_text('2026/09/01 — 2026/09/14')

        page.get_by_role('button', name=re.compile(r'^已封账')).click()
        expect(page.get_by_text('PT-20260910-00001', exact=True)).to_be_visible()
        expect(page.get_by_text('PT-20260911-00001', exact=True)).not_to_be_visible()

        page.get_by_role('button', name=re.compile(r'^全部')).click()
        with page.expect_download() as download_info:
            page.get_by_role('button', name='导出当前筛选').click()
        download = download_info.value
        if download.suggested_filename != '平台明细_2026-09-01_2026-09-14.csv':
            raise AssertionError(
                f'Unexpected export filename: {download.suggested_filename}'
            )
        expect(page.get_by_text('已按当前筛选条件导出 2 条平台明细。')).to_be_visible()

        document_width = page.evaluate('document.documentElement.scrollWidth')
        if document_width > 1601:
            raise AssertionError(f'Desktop page overflows: {document_width}px')
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        latest_list_query = next(
            query for query in reversed(observed_queries)
            if 'pageSize' in query and 'costStatus' not in query
        )
        if 'occurredFrom' not in latest_list_query or 'occurredBefore' not in latest_list_query:
            raise AssertionError(f'Date filters missing from request: {latest_list_query}')
        if not any(
            query.get('occurredFrom') == ['2026-09-27T16:00:00.000Z']
            and query.get('occurredBefore') == ['2026-10-03T16:00:00.000Z']
            for query in observed_queries
        ):
            raise AssertionError(
                f'Confirmed date range was not sent to the API: {observed_queries}'
            )

        page.get_by_role('button', name=re.compile(r'^呼叫任务')).click()
        expect(page.get_by_role('button', name='任务创建日期范围')).to_have_count(1)
        page.get_by_role('button', name=re.compile(r'^平台明细')).click()
        expect(page.get_by_role('button', name='平台明细费用日期范围')).to_be_visible()

        mobile_queries: list[dict] = []
        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        install_fixture(mobile, mobile_queries)
        open_platform_details(mobile)
        expect(mobile.get_by_role('button', name='导出当前筛选')).to_be_visible()
        mobile_width = mobile.evaluate('document.documentElement.scrollWidth')
        if mobile_width > 391:
            raise AssertionError(f'Mobile page overflows: {mobile_width}px')
        mobile.screenshot(path=str(MOBILE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Platform cost detail UI verification passed '
        '(menu + shared date range + live/final rows + full-filter CSV + mobile layout)'
    )
    print(f'Desktop screenshot: {SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')
    print(f'Cross-month range screenshot: {RANGE_SCREENSHOT}')


if __name__ == '__main__':
    main()
