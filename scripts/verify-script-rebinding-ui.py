from pathlib import Path
import json
import re

from playwright.sync_api import Route, expect, sync_playwright

from ui_auth import authenticated_api_json, open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCREENSHOT = Path('/tmp/outbound-platform-script-rebinding.png')


def fulfill(route: Route, data: dict, status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type='application/json',
        body=json.dumps({'requestId': 'script-rebinding-ui-test', 'data': data}),
    )


def main() -> None:
    studio_page = authenticated_api_json('/api/v1/studios?pageNum=0&pageSize=20')
    studios = studio_page['studios']
    if not studios:
        raise AssertionError('Script rebinding UI verification needs one local studio')
    studio = studios[0]
    submitted: list[dict] = []
    current_robot_id = '5608120'
    current_category = {
        'sourceCategoryId': '468',
        'categoryPath': '儿童提醒-拍照-1',
    }

    def handle_scripts(route: Route) -> None:
        fulfill(
            route,
            {
                'total': 1,
                'pages': 1,
                'pageNum': 0,
                'pageSize': 20,
                'scripts': [
                    {
                        'robotDefId': current_robot_id,
                        'robotName': '[新] 6+1-选片一天提醒',
                        'robotStatus': 5,
                        'industryOneName': '摄影服务',
                        'industryTwoName': '儿童摄影',
                        'deployTime': '2026-09-17 09:00:00',
                        'binding': {
                            'robotDefId': current_robot_id,
                            'sourceSystem': 'ERP',
                            'categories': [current_category],
                            'studioId': studio['businessCode'],
                            'studioName': studio['name'],
                            'lineId': 'LINE-UI-1',
                            'lineName': '界面验收线路',
                            'updatedBy': 'ui-verifier',
                            'updatedAt': '2026-09-17T03:00:00.000Z',
                        },
                    }
                ],
            },
        )

    def handle_categories(route: Route) -> None:
        base = {
            'sourceSystem': 'ERP',
            'level': 3,
            'parentId': None,
            'active': True,
            'syncedAt': '2026-09-17T03:00:00.000Z',
        }
        fulfill(
            route,
            {
                'sourceSystem': 'ERP',
                'studioId': studio['businessCode'],
                'configured': True,
                'syncedAt': '2026-09-17T03:00:00.000Z',
                'categories': [
                    {
                        **base,
                        'externalId': '468',
                        'name': '拍照-1',
                        'categoryPath': '儿童提醒-拍照-1',
                        'fields': {
                            'main_category': '儿童提醒',
                            'sub_category': '拍照',
                        },
                        'boundScripts': [
                            {
                                'robotDefId': current_robot_id,
                                'robotName': '[新] 6+1-选片一天提醒',
                            }
                        ],
                    },
                    {
                        **base,
                        'externalId': '469',
                        'name': '选片-1',
                        'categoryPath': '选片提醒-选片-1',
                        'fields': {
                            'main_category': '选片提醒',
                            'sub_category': '选片',
                        },
                        'boundScripts': [
                            {
                                'robotDefId': '5561120',
                                'robotName': '原选片提醒话术',
                            }
                        ],
                    },
                    {
                        **base,
                        'externalId': '470',
                        'name': '邀约-1',
                        'categoryPath': '邀约-邀约-1',
                        'fields': {
                            'main_category': '邀约',
                            'sub_category': '邀约',
                        },
                        'boundScripts': [],
                    },
                ],
            },
        )

    def handle_lines(route: Route) -> None:
        fulfill(
            route,
            {
                'lines': [
                    {
                        'userPhoneId': 'LINE-UI-1',
                        'phone': '95000001',
                        'phoneName': '界面验收线路',
                        'phoneType': 9,
                        'sceneType': 1,
                        'rateType': 0,
                        'localSellingRate': 0,
                        'nonlocalSellingRate': 0,
                        'lineAmount': 2,
                        'billPeriod': 60,
                        'isActive': True,
                        'syncedAt': '2026-09-17T03:00:00.000Z',
                        'studios': [],
                    }
                ]
            },
        )

    def handle_save(route: Route) -> None:
        payload = route.request.post_data_json
        submitted.append(payload)
        fulfill(
            route,
            {
                'binding': {
                    **payload,
                    'updatedBy': 'ui-verifier',
                    'updatedAt': '2026-09-17T03:30:00.000Z',
                }
            },
            status=201,
        )

    def handle_session(route: Route) -> None:
        fulfill(
            route,
            {
                'username': 'ui-verifier',
                'displayName': '界面验收管理员',
                'organization': '测试组织',
            },
        )

    def handle_outbound_tasks(route: Route) -> None:
        fulfill(
            route,
            {
                'total': 0,
                'pages': 0,
                'pageNum': 0,
                'pageSize': 1,
                'statusCounts': {
                    'all': 0,
                    'running': 0,
                    'calling': 0,
                    'completed': 0,
                    'failed': 0,
                },
                'tasks': [],
            },
        )

    def handle_studios(route: Route) -> None:
        fulfill(route, studio_page)

    def handle_unmocked_api(route: Route) -> None:
        route.fulfill(
            status=503,
            content_type='application/json',
            body=json.dumps(
                {
                    'error': {
                        'code': 'UI_TEST_UNMOCKED',
                        'message': 'UI verification intentionally skipped this API',
                        'requestId': 'script-rebinding-ui-test',
                    }
                }
            ),
        )

    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.route(re.compile(r'.*/api/v1/.*'), handle_unmocked_api)
        page.route(re.compile(r'.*/api/v1/operator-session$'), handle_session)
        page.route(re.compile(r'.*/api/v1/outbound-tasks\?.*'), handle_outbound_tasks)
        page.route(re.compile(r'.*/api/v1/studios\?.*'), handle_studios)
        page.route(re.compile(r'.*/api/v1/scripts\?.*'), handle_scripts)
        page.route(re.compile(r'.*/api/v1/data-categories\?.*'), handle_categories)
        page.route(re.compile(r'.*/api/v1/managed-lines$'), handle_lines)
        page.route(re.compile(r'.*/api/v1/script-bindings$'), handle_save)

        open_authenticated(page)
        page.wait_for_timeout(1_000)
        navigation = page.get_by_role('button', name='话术列表', exact=True)
        expect(navigation).to_be_visible()
        navigation.evaluate('(element) => element.click()')
        expect(page.get_by_role('heading', name='话术列表', exact=True)).to_be_visible()
        page.get_by_role('button', name='修改绑定').click()
        dialog = page.get_by_role('dialog')
        expect(dialog.locator('.category-owner-current')).to_have_text('当前话术')
        dialog.locator('details.category-tree-group', has_text='选片提醒').locator(
            'summary'
        ).click()
        dialog.locator('details.category-tree-group', has_text='邀约').locator(
            'summary'
        ).click()
        expect(dialog.get_by_text('已占用 · 原选片提醒话术')).to_be_visible()
        expect(dialog.get_by_text('可用', exact=True)).to_be_visible()

        dialog.get_by_text('选片-1', exact=True).click()
        confirmation = dialog.get_by_label('确认将已占用分类换绑到当前话术')
        expect(confirmation).to_be_visible()
        save = dialog.get_by_role('button', name='确认换绑并保存')
        expect(save).to_be_disabled()
        confirmation.check()
        expect(save).to_be_enabled()
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        save.click()
        expect(dialog).not_to_be_visible()
        browser.close()

    if page_errors:
        raise AssertionError(f'Browser page errors: {page_errors}')
    if len(submitted) != 1:
        raise AssertionError(f'Expected one save request, got {len(submitted)}')
    if submitted[0].get('replaceConflicts') is not True:
        raise AssertionError(f'Rebinding confirmation was not submitted: {submitted[0]}')
    selected_ids = {
        category['sourceCategoryId'] for category in submitted[0]['categories']
    }
    if selected_ids != {'468', '469'}:
        raise AssertionError(f'Unexpected selected categories: {selected_ids}')
    print('Script rebinding UI verification passed')
    print(f'Screenshot: {SCREENSHOT}')


if __name__ == '__main__':
    main()
