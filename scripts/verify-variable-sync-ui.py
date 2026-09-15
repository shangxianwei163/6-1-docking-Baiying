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
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
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
        feedback = page.locator('.mapping-feedback')
        expect(feedback).to_contain_text('百应接口同步已完成', timeout=120_000)
        expect(page.get_by_role('button', name='同步百应变量')).to_be_enabled()

        if not any(url.endswith(f'/api/v1/variable-sync-jobs/{job_id}') for url in status_requests):
            raise AssertionError('The page did not poll the real worker job status')

        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(f'Variable sync UI verification passed for job {job_id[:8]}')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
