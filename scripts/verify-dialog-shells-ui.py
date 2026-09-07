from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_URL = 'http://localhost:4173/'


def verify_mapping_dialogs(page) -> None:
    page.get_by_role('button', name='字段映射', exact=True).click()
    expect(page.get_by_role('heading', name='字段映射中心')).to_be_visible()

    page.get_by_role('tab', name=re.compile(r'^场景状态')).click()
    page.locator('.scene-readiness-table').get_by_role(
        'button', name='查看详情'
    ).first.click()
    scene_dialog = page.get_by_role('dialog')
    expect(scene_dialog.get_by_text('当前话术变量', exact=True)).to_be_visible()
    assert_dialog_has_no_outer_overflow(
        page, scene_dialog, 'Scene variable dialog'
    )
    page.set_viewport_size({'width': 1024, 'height': 640})
    assert_dialog_has_no_outer_overflow(
        page, scene_dialog, 'Scene variable dialog at short viewport'
    )
    scene_dialog.get_by_role('button', name='关闭', exact=True).first.click()

    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.get_by_role('tab', name=re.compile(r'^变量映射')).click()
    page.locator('.rules-panel').get_by_role(
        'button', name=re.compile(r'编辑|配置')
    ).first.click()
    mapping_dialog = page.get_by_role('dialog')
    expect(
        mapping_dialog.get_by_role('heading', name='配置 ERP / CRM 取值关系')
    ).to_be_visible()
    assert_dialog_has_no_outer_overflow(
        page, mapping_dialog, 'Mapping editor dialog'
    )
    page.set_viewport_size({'width': 1024, 'height': 640})
    assert_dialog_has_no_outer_overflow(
        page, mapping_dialog, 'Mapping editor dialog at short viewport'
    )
    mapping_dialog.get_by_role('button', name='取消').click()


def verify_script_dialog(page) -> None:
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.get_by_role('button', name='话术列表', exact=True).click()
    expect(page.get_by_role('heading', name='话术列表')).to_be_visible()
    page.get_by_role(
        'button', name=re.compile(r'配置绑定|修改绑定')
    ).first.click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_role('heading', name='配置话术业务绑定')).to_be_visible()
    assert_dialog_has_no_outer_overflow(page, dialog, 'Script binding dialog')
    page.set_viewport_size({'width': 1024, 'height': 640})
    assert_dialog_has_no_outer_overflow(
        page, dialog, 'Script binding dialog at short viewport'
    )
    dialog.get_by_role('button', name='关闭绑定弹窗').click()


def main() -> None:
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.goto(APP_URL, wait_until='networkidle')
        verify_mapping_dialogs(page)
        verify_script_dialog(page)
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    print(
        'Dialog shell UI verification passed '
        '(scene snapshot + mapping editor + script binding, desktop and short viewport)'
    )


if __name__ == '__main__':
    main()
