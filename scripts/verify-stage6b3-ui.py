from pathlib import Path
import json
import re
from urllib.request import ProxyHandler, Request, build_opener

from playwright.sync_api import expect, sync_playwright


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'
API_BASE_URL = 'http://127.0.0.1:8788'
OVERVIEW_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3-overview.png')
LOG_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3-integration-logs.png')


def api_json(path: str) -> dict:
    opener = build_opener(ProxyHandler({}))
    request = Request(
        f'{API_BASE_URL}{path}',
        headers={'x-actor-id': 'stage6b3-ui-verifier'},
    )
    with opener.open(request, timeout=10) as response:
        return json.load(response)['data']


def main() -> None:
    overview = api_json('/api/v1/operations-overview')
    logs = api_json('/api/v1/integration-logs?pageNum=0&pageSize=20')
    if logs['total'] < 1 or not logs['items']:
        raise AssertionError('Stage 6B-3 UI verification needs one real integration log')
    first_log = logs['items'][0]
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(APP_URL, wait_until='networkidle')

        expect(page.locator('h2').filter(has_text='总览')).to_be_visible()
        expect(page.get_by_text('今日外呼任务', exact=True)).to_be_visible()
        expect(page.get_by_text('回调待处理', exact=True)).to_be_visible()
        expect(page.get_by_text('队列待发布', exact=True)).to_be_visible()
        expect(page.get_by_text('最近受理任务', exact=True)).to_be_visible()
        if overview['recentTasks']:
            expect(
                page.get_by_text(overview['recentTasks'][0]['taskNo'], exact=True)
            ).to_be_visible()
        page.screenshot(path=str(OVERVIEW_SCREENSHOT), full_page=True)

        page.get_by_role('button', name=re.compile(r'^接口日志')).click()
        expect(page.locator('h2').filter(has_text='接口日志')).to_be_visible()
        expect(page.get_by_text('数据库接口调用记录', exact=True)).to_be_visible()
        expect(page.get_by_text('页面不读取原始回调正文', exact=False)).to_be_visible()
        log_row = page.locator('tbody tr').filter(has_text=first_log['requestId']).first
        expect(log_row).to_contain_text(first_log['operationLabel'])
        log_row.get_by_role('button', name='详情').click()

        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_text('接口调用详情', exact=True)).to_be_visible()
        expect(dialog.get_by_text('已脱敏请求 / 响应快照', exact=True)).to_be_visible()
        expect(dialog.get_by_text(first_log['requestId'], exact=True)).to_be_visible()
        page.screenshot(path=str(LOG_SCREENSHOT), full_page=True)
        dialog.get_by_role('button', name='关闭').click()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        mobile.goto(APP_URL, wait_until='networkidle')
        expect(mobile.locator('h2').filter(has_text='总览')).to_be_visible()
        expect(mobile.get_by_text('今日外呼任务', exact=True)).to_be_visible()
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
        'Stage 6B-3 UI verification passed '
        '(real overview + real integration logs + redacted detail + mobile layout)'
    )
    print(f'Overview screenshot: {OVERVIEW_SCREENSHOT}')
    print(f'Integration log screenshot: {LOG_SCREENSHOT}')


if __name__ == '__main__':
    main()
