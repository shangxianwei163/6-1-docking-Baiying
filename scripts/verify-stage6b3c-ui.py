from pathlib import Path
import json
import re

from playwright.sync_api import expect, sync_playwright
from ui_auth import open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCREENSHOT = Path('/tmp/outbound-platform-stage6b3c-callback-preview.png')
MOBILE_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3c-callback-preview-mobile.png')


def open_preview(page) -> None:
    open_authenticated(page)
    page.get_by_role('button', name=re.compile(r'^回调测试')).click()
    expect(page.locator('h2').filter(has_text='回调报文预览')).to_be_visible()


def choose(page, aria_label: str, option: str) -> None:
    page.get_by_role('button', name=aria_label).click()
    page.get_by_role('button', name=option, exact=True).click()


def main() -> None:
    page_errors: list[str] = []
    preview_requests: list[dict] = []
    unexpected_network: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))

        def observe_request(request) -> None:
            if request.url.endswith('/api/v1/callback-previews'):
                preview_requests.append(request.post_data_json)
            elif request.resource_type in {'xhr', 'fetch'} and not re.match(
                r'^https?://(?:localhost|127\.0\.0\.1)(?::\d+)?/', request.url
            ):
                unexpected_network.append(request.url)

        page.on('request', observe_request)
        open_preview(page)

        expect(page.get_by_text('网络投递已从服务能力中移除', exact=True)).to_be_visible()
        expect(page.get_by_text('0 次投递', exact=True)).to_be_visible()
        expect(page.get_by_text('本工具永不开放', exact=False)).to_be_visible()
        expect(page.get_by_role('button', name='生成模拟报文（不发送）')).to_be_visible()
        if page.locator('input').count() != 0:
            raise AssertionError('Safe preview must not expose a callback URL or secret input')

        page.get_by_role('button', name='生成模拟报文（不发送）').click()
        expect(page.get_by_text('已生成 · 未发送', exact=True)).to_be_visible()
        expect(page.get_by_text('DISABLED', exact=True)).to_be_visible()
        expect(page.locator('.callback-body-section pre')).to_contain_text(
            '"phoneMasked": "138****0000"'
        )

        choose(page, '选择模拟接收系统', 'CRM')
        choose(page, '选择模拟事件类型', '录音可用批次')
        choose(page, '选择模拟数据条数', '3 条')
        page.get_by_role('button', name='生成模拟报文（不发送）').click()
        body_text = page.locator('.callback-body-section pre').inner_text()
        if body_text.count('example.invalid') != 3:
            raise AssertionError('Recording preview must contain three invalid-domain URLs')
        if '.com/callback' in body_text or '.cn/callback' in body_text:
            raise AssertionError('Preview unexpectedly contains a routable callback endpoint')
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        if len(preview_requests) != 2:
            raise AssertionError(f'Expected two preview requests, got {len(preview_requests)}')
        for payload in preview_requests:
            if set(payload) != {'environment', 'sourceSystem', 'eventType', 'itemCount'}:
                raise AssertionError(f'Unsafe preview request shape: {json.dumps(payload)}')
            if payload['environment'] != 'SAFE_PREVIEW':
                raise AssertionError(f'Unexpected preview environment: {payload}')

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        open_preview(mobile)
        mobile.get_by_role('button', name='生成模拟报文（不发送）').click()
        expect(mobile.get_by_text('已生成 · 未发送', exact=True)).to_be_visible()
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
        'Stage 6B-3C UI verification passed '
        '(safe-only request contract + synthetic payloads + no URL/secret controls + mobile layout)'
    )
    print(f'Callback preview screenshot: {SCREENSHOT}')
    print(f'Mobile screenshot: {MOBILE_SCREENSHOT}')


if __name__ == '__main__':
    main()
