/* global chrome */
document.getElementById('agent').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('agent.html') });
});
