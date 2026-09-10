from pathlib import Path
import json
import re

from playwright.sync_api import Route, expect, sync_playwright

from dialog_assertions import assert_dialog_has_no_outer_overflow
from ui_auth import open_authenticated


CHROME = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
TASK_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3b-task-control.png')
RECOVERY_SCREENSHOT = Path('/tmp/outbound-platform-stage6b3b-recovery.png')
TASK_NO = 'PT-20260906-90001'


def fake_task(execution_status: str = 'CALLING') -> dict:
    paused = execution_status == 'PAUSED'
    return {
        'taskId': '01993053-2530-7000-8000-000000000001',
        'taskNo': TASK_NO,
        'externalRequestId': 'stage6b3b-ui-task',
        'sourceSystem': 'CRM',
        'mcCode': 'MC-UI-VERIFY',
        'studioId': '01993053-2530-7000-8000-000000000002',
        'studioName': '浏览器验收影楼',
        'taskName': '阶段 6B-3B 任务控制验收',
        'phoneCount': 12,
        'dataCategories': [
            {'id': 'category-ui', 'path': '客户/待回访'},
        ],
        'script': {'robotDefId': 'robot-ui', 'name': '到店回访话术'},
        'line': {'userPhoneId': 'line-ui', 'name': '本地安全线路'},
        'mapping': {
            'version': 3,
            'variableCount': 2,
            'variables': ['customerName', 'appointmentDate'],
        },
        'callbacks': {
            'resultUrl': 'https://crm.example.test/callbacks/result',
            'recordingUrl': 'https://crm.example.test/callbacks/recording',
        },
        'actions': {
            'commands': ['RESUME', 'TERMINATE'] if paused else ['PAUSE', 'TERMINATE'],
            'retry': {'available': False, 'blockedReason': None},
        },
        'baiyingCallJobId': 'local-job-ui-90001',
        'providerStatus': {
            'code': 4 if paused else 1,
            'description': '已暂停' if paused else '呼叫中',
        },
        'statuses': {
            'execution': execution_status,
            'display': '呼叫中',
            'resultDelivery': 'PENDING',
            'recordingArchive': 'PENDING',
            'recordingDelivery': 'PENDING',
            'billing': 'RESERVED',
        },
        'importSummary': {
            'requested': 12,
            'succeeded': 12,
            'failed': 0,
            'repeated': 0,
        },
        'counts': {
            'imported': 12,
            'callInstances': 0,
            'recordingsDiscovered': 0,
            'recordingsArchived': 0,
            'recordingsDelivered': 0,
        },
        'durations': {'totalSeconds': 0, 'billingMinutes': 0},
        'billing': {
            'currency': 'CNY',
            'customerRate': '0.120000',
            'frozenMinutes': 3,
            'reservedAmount': '4.320000',
            'customerCharge': '0.000000',
            'platformRate': None,
            'platformRateStatus': 'NOT_AVAILABLE',
            'platformCost': None,
            'profit': None,
            'studioBalance': '1000.000000',
            'availableBalance': '995.680000',
            'status': 'RESERVED',
        },
        'failure': None,
        'timestamps': {
            'createdAt': '2026-09-06T09:00:00.000Z',
            'acceptedAt': '2026-09-06T09:00:01.000Z',
            'startedAt': '2026-09-06T09:00:10.000Z',
            'providerCompletedAt': None,
            'reconciledAt': None,
            'closedAt': None,
        },
    }


def fake_dead_letters() -> list[dict]:
    common = {
        'taskNo': TASK_NO,
        'replayCount': 0,
        'suggestedAction': '确认根因已消除后，恢复原记录重试',
        'replayable': True,
        'replayBlockedReason': None,
        'sourceStatus': 'DEAD_LETTERED',
        'createdAt': '2026-09-06T09:30:00.000Z',
        'resolvedBy': None,
        'resolvedAt': None,
        'resolutionNote': None,
    }
    return [
        {
            **common,
            'id': '01993053-2530-7000-8000-000000000010',
            'sourceType': 'OUTBOX',
            'sourceId': '01993053-2530-7000-8000-000000000011',
            'sourceLabel': '队列事件',
            'eventType': 'TASK_ACCEPTED',
            'status': 'OPEN',
            'finalError': '编排队列重试已耗尽',
            'originalSummary': {
                'queueName': 'task-orchestration-queue',
                'attemptCount': 5,
                'phone': '[已脱敏]',
            },
        },
        {
            **common,
            'id': '01993053-2530-7000-8000-000000000020',
            'sourceType': 'CALLBACK',
            'sourceId': '01993053-2530-7000-8000-000000000021',
            'sourceLabel': '百应回调',
            'eventType': 'CALL_FINISHED',
            'status': 'OPEN',
            'finalError': '回调字段校验连续失败',
            'originalSummary': {
                'parseStatus': 'FAILED',
                'attemptCount': 4,
                'token': '[已脱敏]',
            },
        },
    ]


def envelope(data: dict) -> str:
    return json.dumps({'requestId': 'stage6b3b-browser-fixture', 'data': data})


def install_fixtures(page) -> None:
    state = {'taskStatus': 'CALLING'}
    dead_letters = fake_dead_letters()

    def handle_tasks(route: Route) -> None:
        request = route.request
        url = request.url
        task = fake_task(state['taskStatus'])
        if '/calls?' in url:
            route.fulfill(
                status=200,
                content_type='application/json',
                body=envelope({'items': [], 'nextCursor': None}),
            )
            return
        if url.endswith('/commands') and request.method == 'POST':
            payload = request.post_data_json
            if payload['command'] != 'PAUSE' or len(payload['reason'].strip()) < 2:
                raise AssertionError(f'Unexpected task command payload: {payload}')
            state['taskStatus'] = 'PAUSED'
            route.fulfill(
                status=200,
                content_type='application/json',
                body=envelope(
                    {
                        'actionId': '01993053-2530-7000-8000-000000000030',
                        'taskNo': TASK_NO,
                        'action': 'PAUSE',
                        'status': 'SUCCEEDED',
                        'executionStatus': 'PAUSED',
                        'providerMode': 'LOCAL_SIMULATION',
                        'idempotentReplay': False,
                        'requestedAt': '2026-09-06T09:35:00.000Z',
                        'message': '本地安全模拟已确认命令；未联网、未产生真实外呼',
                    }
                ),
            )
            return
        if request.method == 'GET' and re.search(r'/outbound-tasks/[^/?]+$', url):
            route.fulfill(
                status=200,
                content_type='application/json',
                body=envelope({'task': task}),
            )
            return
        if request.method == 'GET':
            route.fulfill(
                status=200,
                content_type='application/json',
                body=envelope(
                    {
                        'total': 1,
                        'pages': 1,
                        'pageNum': 0,
                        'pageSize': 20,
                        'statusCounts': {
                            'all': 1,
                            'running': 0,
                            'calling': 1,
                            'completed': 0,
                            'failed': 0,
                        },
                        'tasks': [task],
                    }
                ),
            )
            return
        route.continue_()

    def handle_dead_letters(route: Route) -> None:
        request = route.request
        if request.method == 'GET':
            summary = {
                'all': len(dead_letters),
                'open': sum(item['status'] == 'OPEN' for item in dead_letters),
                'replaying': sum(item['status'] == 'REPLAYING' for item in dead_letters),
                'resolved': 0,
                'ignored': sum(item['status'] == 'IGNORED' for item in dead_letters),
                'outbox': 1,
                'callback': 1,
                'recording': 0,
                'delivery': 0,
            }
            route.fulfill(
                status=200,
                content_type='application/json',
                body=envelope(
                    {
                        'total': len(dead_letters),
                        'pages': 1,
                        'pageNum': 0,
                        'pageSize': 20,
                        'summary': summary,
                        'items': dead_letters,
                    }
                ),
            )
            return
        match = re.search(r'/dead-letters/([^/]+)/(replay|ignore)$', request.url)
        if not match:
            route.continue_()
            return
        payload = request.post_data_json
        if len(payload['reason'].strip()) < 2:
            raise AssertionError(f'Unexpected recovery payload: {payload}')
        item = next(value for value in dead_letters if value['id'] == match.group(1))
        action = match.group(2)
        item['status'] = 'REPLAYING' if action == 'replay' else 'IGNORED'
        item['replayCount'] += 1 if action == 'replay' else 0
        item['sourceStatus'] = 'PENDING' if action == 'replay' else item['sourceStatus']
        item['resolvedBy'] = 'platform-admin'
        item['resolvedAt'] = '2026-09-06T09:36:00.000Z'
        item['resolutionNote'] = payload['reason']
        route.fulfill(
            status=200,
            content_type='application/json',
            body=envelope(
                {
                    'deadLetter': item,
                    'idempotentReplay': False,
                    'message': '原事件已恢复，等待工作进程处理'
                    if action == 'replay'
                    else '异常事件已标记为忽略',
                }
            ),
        )

    page.route(re.compile(r'.*/api/v1/outbound-tasks(?:\?.*|/.*)?$'), handle_tasks)
    page.route(re.compile(r'.*/api/v1/dead-letters(?:\?.*|/.*)?$'), handle_dead_letters)


def main() -> None:
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=str(CHROME) if CHROME.exists() else None,
            headless=True,
        )
        page = browser.new_page(viewport={'width': 1600, 'height': 1000})
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        install_fixtures(page)
        open_authenticated(page)

        page.get_by_role('button', name=re.compile(r'^呼叫任务')).click()
        row = page.locator('tr', has_text=TASK_NO)
        expect(row.get_by_text('呼叫中', exact=True).first).to_be_visible()
        row.get_by_role('button', name='查看详情').click()
        task_dialog = page.get_by_role('dialog').filter(has_text='阶段 6B-3B 任务控制验收')
        expect(task_dialog.get_by_text('任务处置', exact=True)).to_be_visible()
        expect(task_dialog.get_by_role('button', name='暂停')).to_be_visible()
        task_dialog.get_by_role('button', name='暂停').click()

        action_dialog = page.get_by_role('dialog').filter(has_text='暂停呼叫任务')
        expect(action_dialog.get_by_role('button', name='确认暂停')).to_be_enabled()
        assert_dialog_has_no_outer_overflow(page, action_dialog, 'Task action dialog')
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_outer_overflow(
            page, action_dialog, 'Task action dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        action_dialog.get_by_placeholder('例如：影楼临时暂停本次营销活动').fill(
            '浏览器验收暂停，不触发真实外呼'
        )
        action_dialog.get_by_role('button', name='确认暂停').click()
        expect(page.get_by_text('本地安全模拟已确认命令；未联网、未产生真实外呼')).to_be_visible()
        expect(task_dialog.get_by_role('button', name='恢复')).to_be_visible()
        page.screenshot(path=str(TASK_SCREENSHOT), full_page=True)
        task_dialog.locator('[data-slot="dialog-close"]').click()

        page.get_by_role('button', name=re.compile(r'^异常中心')).click()
        expect(page.locator('h2').filter(has_text='异常中心')).to_be_visible()
        expect(page.get_by_text('页面只显示脱敏摘要', exact=False)).to_be_visible()
        outbox_row = page.locator('tr', has_text='编排队列重试已耗尽')
        outbox_row.get_by_role('button', name='处置').click()
        recovery_dialog = page.get_by_role('dialog').filter(has_text='编排队列重试已耗尽')
        expect(recovery_dialog.get_by_text('[已脱敏]', exact=True)).to_be_visible()
        assert_dialog_has_no_outer_overflow(
            page, recovery_dialog, 'Recovery detail dialog'
        )
        page.set_viewport_size({'width': 1024, 'height': 640})
        assert_dialog_has_no_outer_overflow(
            page, recovery_dialog, 'Recovery detail dialog at short viewport'
        )
        page.set_viewport_size({'width': 1600, 'height': 1000})
        recovery_dialog.get_by_placeholder('例如：已修复回调字段兼容问题，批准重放原事件').fill(
            '根因已修复，批准恢复原队列事件'
        )
        recovery_dialog.get_by_role('button', name='重放原事件').click()
        expect(recovery_dialog.get_by_text('原事件已恢复，等待工作进程处理')).to_be_visible()
        expect(recovery_dialog.get_by_text('重放中', exact=True)).to_be_visible()
        recovery_dialog.get_by_role('button', name='关闭').click()

        callback_row = page.locator('tr', has_text='回调字段校验连续失败')
        callback_row.get_by_role('button', name='处置').click()
        ignore_dialog = page.get_by_role('dialog').filter(has_text='回调字段校验连续失败')
        assert_dialog_has_no_outer_overflow(
            page, ignore_dialog, 'Recovery ignore dialog'
        )
        ignore_dialog.get_by_placeholder('例如：已修复回调字段兼容问题，批准重放原事件').fill(
            '确认该测试回调无需继续处理'
        )
        ignore_dialog.get_by_role('button', name='标记忽略').click()
        expect(ignore_dialog.get_by_text('异常事件已标记为忽略')).to_be_visible()
        expect(ignore_dialog.get_by_text('已忽略', exact=True)).to_be_visible()
        page.screenshot(path=str(RECOVERY_SCREENSHOT), full_page=True)
        ignore_dialog.get_by_role('button', name='关闭').click()

        mobile = browser.new_page(viewport={'width': 390, 'height': 844})
        mobile.on('pageerror', lambda error: page_errors.append(str(error)))
        install_fixtures(mobile)
        open_authenticated(mobile)
        mobile.get_by_role('button', name=re.compile(r'^异常中心')).click()
        expect(mobile.locator('h2').filter(has_text='异常中心')).to_be_visible()
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
        'Stage 6B-3B UI verification passed '
        '(task confirmation + audited recovery + redacted detail + mobile layout)'
    )
    print(f'Task control screenshot: {TASK_SCREENSHOT}')
    print(f'Recovery screenshot: {RECOVERY_SCREENSHOT}')


if __name__ == '__main__':
    main()
