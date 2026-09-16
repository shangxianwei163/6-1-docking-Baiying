import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from ui_auth import open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCREENSHOT = Path('/tmp/outbound-platform-variable-sync.png')


def main() -> None:
    page_errors: list[str] = []
    status_requests: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1327, 'height': 964})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.on(
            'request',
            lambda request: status_requests.append(request.url)
            if '/api/v1/variable-sync-jobs/' in request.url
            else None,
        )
        open_authenticated(page)

        nav = page.get_by_role('navigation', name='平台功能菜单')
        setup = nav.get_by_role('button', name='初始管理', exact=True)
        if setup.get_attribute('aria-expanded') != 'true':
            setup.click()
        nav.get_by_role('button', name='字段映射', exact=True).click()
        expect(page.get_by_role('heading', name='字段映射中心')).to_be_visible()

        pending_list = page.locator('.pending-list')
        if pending_list.count():
            pending_style = pending_list.evaluate(
                "element => ({ alignContent: getComputedStyle(element).alignContent, gridAutoRows: getComputedStyle(element).gridAutoRows })"
            )
            if pending_style != {'alignContent': 'start', 'gridAutoRows': 'max-content'}:
                raise AssertionError(f'Pending list rows may stretch: {pending_style}')
            first_pending = pending_list.locator('.pending-item').first.bounding_box()
            if first_pending is None or first_pending['height'] > 120:
                raise AssertionError(f'Pending row is not compact: {first_pending}')
            pending_box = pending_list.bounding_box()
            if pending_box is None or first_pending['y'] - pending_box['y'] > 2:
                raise AssertionError('Pending rows do not start at the top of the list')

        page.get_by_role('tab', name=re.compile('版本记录')).click()
        first_version = page.locator('.version-list article').first
        expect(first_version).to_be_visible()
        version_style = page.locator('.version-list').evaluate(
            "element => ({ alignContent: getComputedStyle(element).alignContent, gridAutoRows: getComputedStyle(element).gridAutoRows })"
        )
        if version_style != {'alignContent': 'start', 'gridAutoRows': 'max-content'}:
            raise AssertionError(f'Version list rows may stretch: {version_style}')
        version_box = first_version.bounding_box()
        if version_box is None or version_box['height'] > 120:
            raise AssertionError(f'Version row is not compact: {version_box}')
        version_list_box = page.locator('.version-list').bounding_box()
        if version_list_box is None or version_box['y'] - version_list_box['y'] > 2:
            raise AssertionError('Version rows do not start at the top of the list')
        page.get_by_role('tab', name=re.compile('待处理变量')).click()

        with page.expect_response(
            lambda response: response.request.method == 'POST'
            and response.url.endswith('/api/v1/variable-sync-jobs')
        ) as queued_response:
            page.get_by_role('button', name='同步百应变量').click()

        response = queued_response.value
        if response.status != 202:
            raise AssertionError(f'Variable sync queue returned HTTP {response.status}')
        job_id = response.json()['data']['jobId']
        expect(page.get_by_role('button', name='正在同步…')).to_be_visible()
        toast = page.locator('[data-slot="toast"]')
        expect(toast).to_contain_text('百应变量同步完成', timeout=120_000)
        expect(page.get_by_role('button', name='同步百应变量')).to_be_enabled()

        inspection_height = page.get_by_role('region', name='变量巡检').bounding_box()
        if inspection_height is None or inspection_height['height'] > 100:
            raise AssertionError(
                f'Variable inspection panel is not compact: {inspection_height}'
            )

        if not any(url.endswith(f'/api/v1/variable-sync-jobs/{job_id}') for url in status_requests):
            raise AssertionError('The page did not poll the real worker job status')

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        expect(toast).to_be_hidden(timeout=8_000)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(f'Variable sync UI verification passed for job {job_id[:8]}')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
