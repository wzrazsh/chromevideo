document.addEventListener('DOMContentLoaded', () => {
  const statusText = document.getElementById('statusText');
  const taskInfo = document.getElementById('taskInfo');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');

  function updateStatus(status) {
    statusText.textContent = status.polling ? '运行中' : '已停止';
    btnStart.disabled = status.polling;
    btnStop.disabled = !status.polling;

    if (status.currentTask) {
      taskInfo.style.display = 'block';
      taskInfo.textContent = `当前任务: ${status.currentTask.url}`;
    } else {
      taskInfo.style.display = 'none';
    }
  }

  function refreshStatus() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (response) {
        updateStatus(response);
      }
    });
  }

  btnStart.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startPolling' }, (response) => {
      if (response && response.success) {
        refreshStatus();
      }
    });
  });

  btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopPolling' }, (response) => {
      if (response && response.success) {
        refreshStatus();
      }
    });
  });

  refreshStatus();
  setInterval(refreshStatus, 2000);
});
