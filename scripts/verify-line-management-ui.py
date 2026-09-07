from pathlib import Path
import json
import re

from playwright.sync_api import Route, expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
LIVE_SCREENSHOT = Path('/tmp/outbound-platform-lines-live.png')
STALE_SCREENSHOT = Path('/tmp/outbound-platform-lines-stale.png')


def open_line_management(page) -> None:
    page.goto(APP_URL, wait_until='networkidle')
    page.get_by_role('button', name='线路管理', exact=True).click()
    expect(page.get_by_role('heading', name='线路管理', exact=True)).to_be_visible()


def install_stale_fixture(page) -> None:
    data = {
        'sync': {
            'status': 'STALE',
            'attemptedAt': '2026-09-07T02:00:00.000Z',
            'lastSuccessfulAt': '2026-09-04T02:00:00.000Z',
            'errorCode': 'LINE_SYNC_UNAVAILABLE',
            'message': '实时同步失败，当前展示上次成功缓存',
        },
        'lines': [
            {
                'userPhoneId': 'LIVE-LINE-001',
                'phone': '0571-10001',
                'phoneName': '缓存可用线路',
                'phoneType': 9,
                'sceneType': 1,
                'rateType': 0,
                'localSellingRate': 0,
                'nonlocalSellingRate': 0,
                'lineAmount': 2,
                'billPeriod': 60,
                'isActive': True,
                'syncedAt': '2026-09-04T02:00:00.000Z',
                'studios': [],
            },
            {
                'userPhoneId': 'HISTORY-LINE-001',
                'phone': '0571-10002',
                'phoneName': '历史保留线路',
                'phoneType': 9,
                'sceneType': 1,
                'rateType': 0,
                'localSellingRate': 0,
                'nonlocalSellingRate': 0,
                'lineAmount': 2,
                'billPeriod': 60,
                'isActive': False,
                'syncedAt': '2026-09-03T02:00:00.000Z',
                'studios': [],
            },
        ],
    }

    def handle(route: Route) -> None:
        route.fulfill(
            status=200,
            content_type='application/json',
            body=json.dumps({'requestId': 'line-ui-fixture', 'data': data}),
        )

    page.route(re.compile(r'.*/api/v1/lines(?:\?.*)?$'), handle)


def main() -> None:
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )

        live = browser.new_page(viewport={'width': 1440, 'height': 1000})
        live.on('pageerror', lambda error: page_errors.append(str(error)))
        open_line_management(live)
        expect(live.get_by_text('百应实时数据', exact=True)).to_be_visible()
        expect(live.get_by_text('未能读取百应线路列表', exact=True)).not_to_be_visible()
        expect(live.locator('.line-card').first).to_be_visible()
        if live.locator('.line-card').count() < 1:
            raise AssertionError('Live synchronization returned no line cards')
        if live.locator('.line-card:not(.is-inactive)').count() < 1:
            raise AssertionError('Live synchronization returned no active line')
        live.screenshot(path=str(LIVE_SCREENSHOT), full_page=True)

        stale = browser.new_page(viewport={'width': 1440, 'height': 1000})
        stale.on('pageerror', lambda error: page_errors.append(str(error)))
        install_stale_fixture(stale)
        open_line_management(stale)
        expect(stale.get_by_text('缓存数据', exact=True)).to_be_visible()
        expect(stale.get_by_text(re.compile('LINE_SYNC_UNAVAILABLE'))).to_be_visible()
        expect(
            stale.get_by_role('heading', name='缓存可用线路', exact=True)
        ).to_be_visible()
        expect(stale.get_by_text('历史保留线路', exact=True)).to_be_visible()
        expect(stale.get_by_text('历史停用', exact=True)).to_be_visible()
        expect(stale.locator('.line-card.is-inactive')).to_have_count(1)
        expect(
            stale.locator('.line-card.is-inactive').get_by_role(
                'button', name=re.compile('历史保留')
            )
        ).to_be_disabled()
        stale.screenshot(path=str(STALE_SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Line management UI verification passed (live sync + stale cache + inactive guard)')
    print(f'Live screenshot: {LIVE_SCREENSHOT}')
    print(f'Stale screenshot: {STALE_SCREENSHOT}')


if __name__ == '__main__':
    main()
