from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow
from ui_auth import authenticated_api_json, open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
OVERVIEW_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3-overview.png')
LOG_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3-integration-logs.png')


def main() -> None:
    overview = authenticated_api_json('/api/v1/operations-overview')
    logs = authenticated_api_json(
        '/api/v1/integration-logs?pageNum=0&pageSize=20'
    )
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
        open_authenticated(page)

        expect(page.locator('h2').filter(has_text='总览')).to_be_visible()
        expect(page.get_by_text('今日外呼任务', exact=True)).to_be_visible()
        expect(page.get_by_text('回调待处理', exact=True)).to_be_visible()
        expect(page.get_by_text('队列待发布', exact=True)).to_be_visible()
        expect(page.get_by_text('接口质量与关联告警', exact=True)).to_be_visible()
        expect(page.get_by_text('GUID 主关联成功率', exact=True)).to_be_visible()
        expect(page.get_by_text('手机号后备匹配', exact=True)).to_be_visible()
        expect(page.get_by_text('号码关联冲突', exact=True)).to_be_visible()
        expect(page.get_by_text('分类匹配歧义', exact=True)).to_be_visible()
        expect(page.get_by_text('百应重复回调', exact=True)).to_be_visible()
        expect(page.get_by_text('ERP / CRM 回传失败', exact=True)).to_be_visible()
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
        assert_dialog_has_no_outer_overflow(page, dialog, 'Integration detail dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_outer_overflow(
            page, dialog, 'Integration detail dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        page.screenshot(path=str(LOG_SCREENSHOT), full_page=True)
        dialog.get_by_role('button', name='关闭').click()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        open_authenticated(mobile)
        expect(mobile.locator('h2').filter(has_text='总览')).to_be_visible()
        expect(mobile.get_by_text('今日外呼任务', exact=True)).to_be_visible()
        expect(
            mobile.get_by_text('接口质量与关联告警', exact=True)
        ).to_be_visible()
        mobile.get_by_role('button', name=re.compile(r'^接口日志')).click()
        mobile_log_row = (
            mobile.locator('tbody tr').filter(has_text=first_log['requestId']).first
        )
        mobile_log_row.get_by_role('button', name='详情').click()
        mobile_dialog = mobile.get_by_role('dialog')
        expect(mobile_dialog.get_by_text('接口调用详情', exact=True)).to_be_visible()
        assert_dialog_has_no_outer_overflow(
            mobile, mobile_dialog, 'Integration detail dialog on mobile'
        )
        mobile_dialog.get_by_role('button', name='关闭').click()
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
