from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import expect, sync_playwright

from ui_auth import authenticated_api_json, open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCREENSHOT = Path('/tmp/outbound-platform-full-integration-request.png')


def main() -> None:
    logs = authenticated_api_json(
        '/api/v1/integration-logs?sourceSystem=BAIYING&direction=OUTBOUND&pageNum=0&pageSize=100'
    )
    selected = next(
        (item for item in logs['items'] if item['operationCode'] == 'IMPORT'),
        None,
    )
    if not selected:
        raise AssertionError('No Baiying import log is available for UI verification')
    detail = authenticated_api_json(
        f"/api/v1/integration-logs/{quote(selected['id'], safe='')}/detail"
    )
    request = detail['request']
    customers = request.get('customerInfoVOList', [])
    if detail['detailLevel'] != 'FULL' or not customers:
        raise AssertionError('Import detail did not return the complete customer request')
    first_customer = customers[0]
    if (
        not first_customer.get('name')
        or not first_customer.get('phone')
        or not first_customer.get('properties')
        or '*' in first_customer['phone']
        or first_customer['phone'] == '[REDACTED]'
    ):
        raise AssertionError('Import request still contains missing or redacted business fields')

    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(page)

        nav = page.get_by_role('navigation', name='平台功能菜单')
        system = nav.get_by_role('button', name='系统日志', exact=True)
        if system.get_attribute('aria-expanded') != 'true':
            system.click()
        nav.get_by_role('button', name='接口日志', exact=True).click()
        expect(page.get_by_role('heading', name='接口日志', exact=True)).to_be_visible()
        page.get_by_placeholder('搜索请求 ID、任务号、操作或端点').fill(
            selected['taskNo']
        )
        row = page.locator('tbody tr').filter(has_text='导入外呼名单').first
        expect(row).to_be_visible()
        row.get_by_role('button', name='详情').click()

        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_text('完整未脱敏')).to_be_visible()
        request_document = dialog.locator('.integration-payload-document pre')
        expect(request_document).to_contain_text('customerInfoVOList')
        expect(request_document).to_contain_text(first_customer['phone'])
        expect(request_document).not_to_contain_text('[REDACTED]')
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print('Full integration request UI verification passed')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
