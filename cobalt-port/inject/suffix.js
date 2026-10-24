
    } catch (error) {
      window.__ytafUserScriptError = String((error && error.stack) || error);
    }
  }
  if (document.head) {
    runUserScript();
    return;
  }
  var observer = new MutationObserver(function () {
    if (document.head) {
      observer.disconnect();
      runUserScript();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
})();
