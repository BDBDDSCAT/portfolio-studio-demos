let language = 'en';
try { language = localStorage.getItem('scientific-tools-language') === 'zh' ? 'zh' : 'en'; } catch {}
function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-en][data-zh]')) {
    element.textContent = element.dataset[language];
  }
  document.querySelector('#language').textContent = language === 'en' ? '中文' : 'English';
}
document.querySelector('#language').addEventListener('click', () => {
  language = language === 'en' ? 'zh' : 'en';
  try { localStorage.setItem('scientific-tools-language', language); } catch {}
  translate();
});
translate();
