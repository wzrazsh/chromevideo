document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('actionBtn');
  
  if (btn) {
    btn.addEventListener('click', async () => {
      // 演示：向当前活动的标签页发送消息
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
          console.log('收到来自 content script 的响应:', response);
          if (response && response.status === 'ok') {
            btn.textContent = '交互成功！';
            btn.style.backgroundColor = '#2196F3';
            setTimeout(() => {
              btn.textContent = '点击测试';
              btn.style.backgroundColor = '#4CAF50';
            }, 2000);
          }
        });
      }
    });
  }
});
