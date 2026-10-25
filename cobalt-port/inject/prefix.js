(function () {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  [Element.prototype, CharacterData.prototype, DocumentType.prototype].forEach(function (proto) {
    if (proto && !proto.remove) {
      proto.remove = function () {
        if (this.parentNode) this.parentNode.removeChild(this);
      };
    }
  });

  if (!HTMLElement.prototype.click) {
    HTMLElement.prototype.click = function () {
      this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    };
  }

  function cobaltSelector(selector) {
    return String(selector)
      .replace(/:not\(\[[^\]]*\]\)/g, '')
      .replace(/\[type=['"]?([a-z]+)['"]?\]/g, '.ytaf-input-$1');
  }
  if (!Element.prototype.matches) {
    Element.prototype.matches = function (selector) {
      var root = this.parentNode || document;
      var nodes = root.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) if (nodes[i] === this) return true;
      return false;
    };
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      for (var node = this; node && node.nodeType === 1; node = node.parentNode) {
        if (node.matches(selector)) return node;
      }
      return null;
    };
  }
  [Document.prototype, Element.prototype].forEach(function (proto) {
    ['querySelector', 'querySelectorAll', 'matches', 'closest'].forEach(function (name) {
      var native = proto[name];
      if (typeof native !== 'function') return;
      proto[name] = function (selector) {
        return native.call(this, cobaltSelector(selector));
      };
    });
  });

  var nativeCreateElement = Document.prototype.createElement;
  function upgradeInput(input) {
    var type = '';
    var checked = false;
    var nativeSetAttribute = input.setAttribute;
    Object.defineProperty(input, 'type', {
      configurable: true,
      get: function () {
        return type;
      },
      set: function (value) {
        if (type) input.classList.remove('ytaf-input-' + type);
        type = String(value).toLowerCase();
        input.classList.add('ytaf-input-' + type);
      }
    });
    Object.defineProperty(input, 'checked', {
      configurable: true,
      get: function () {
        return checked;
      },
      set: function (value) {
        checked = !!value;
        input.classList.toggle('ytaf-checked', checked);
        input.style.display = 'none';
        void input.offsetWidth;
        input.style.display = '';
      }
    });
    input.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'type') input.type = value;
      return nativeSetAttribute.call(this, name, value);
    };
    input.click = function () {
      var proceed = input.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
      if (proceed && type === 'checkbox') {
        input.checked = !checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    input.type = 'text';
    input.tabIndex = 0;
  }
  function upgradeImage(image) {
    var source = '';
    Object.defineProperty(image, 'src', {
      configurable: true,
      get: function () {
        return source;
      },
      set: function (value) {
        source = String(value);
        image.style.backgroundImage = source ? 'url("' + source.replace(/"/g, '%22') + '")' : '';
      }
    });
    image.style.display = 'inline-block';
    image.style.backgroundSize = 'contain';
    image.style.backgroundRepeat = 'no-repeat';
    image.style.backgroundPosition = 'center';
  }
  Document.prototype.createElement = function (tag) {
    var element = nativeCreateElement.apply(this, arguments);
    var name = String(tag).toLowerCase();
    if (name === 'input') upgradeInput(element);
    else if (name === 'button') element.tabIndex = 0;
    else if (name === 'img') upgradeImage(element);
    return element;
  };

  var textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  var nativeAppendChild = Node.prototype.appendChild;
  var nativeInsertBefore = Node.prototype.insertBefore;
  var nativeRemoveChild = Node.prototype.removeChild;

  function isStyle(node) {
    return node && node.nodeType === 1 && node.tagName === 'STYLE';
  }

  function cobaltCss(css) {
    return css
      .replace(/\[type=['"]?([a-z]+)['"]?\]/g, '.ytaf-input-$1')
      .replace(/:checked/g, '.ytaf-checked');
  }

  function refreshStyleLink(style) {
    var link = style.__ytafLink;
    var previous = link.href;
    var css = cobaltCss(textContent.get.call(style) || '');
    link.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
    if (previous) URL.revokeObjectURL(previous);
  }

  function linkFor(style) {
    if (!style.__ytafLink) {
      style.__ytafLink = document.createElement('link');
      style.__ytafLink.rel = 'stylesheet';
      Object.defineProperty(style, 'textContent', {
        configurable: true,
        get: function () {
          return textContent.get.call(this);
        },
        set: function (value) {
          textContent.set.call(this, value);
          if (this.__ytafLink.parentNode) refreshStyleLink(this);
        }
      });
    }
    refreshStyleLink(style);
    return style.__ytafLink;
  }

  if (!document.createDocumentFragment) {
    Document.prototype.createDocumentFragment = function () {
      var fragment = nativeCreateElement.call(this, 'div');
      fragment.__ytafFragment = true;
      return fragment;
    };
    if (Object.prototype.hasOwnProperty.call(document, 'createDocumentFragment')) {
      document.createDocumentFragment = Document.prototype.createDocumentFragment;
    }
  }

  function insertFragment(parent, fragment, reference) {
    while (fragment.firstChild) nativeInsertBefore.call(parent, fragment.firstChild, reference || null);
    return fragment;
  }

  Node.prototype.appendChild = function (child) {
    if (child && child.__ytafFragment) return insertFragment(this, child, null);
    var result = nativeAppendChild.call(this, child);
    if (isStyle(child)) nativeAppendChild.call(document.head || this, linkFor(child));
    else if (isStyle(this) && this.__ytafLink) refreshStyleLink(this);
    return result;
  };
  Node.prototype.insertBefore = function (child, reference) {
    if (child && child.__ytafFragment) return insertFragment(this, child, reference);
    var result = nativeInsertBefore.call(this, child, reference);
    if (isStyle(child)) nativeAppendChild.call(document.head || this, linkFor(child));
    return result;
  };
  Node.prototype.removeChild = function (child) {
    if (isStyle(child) && child.__ytafLink && child.__ytafLink.parentNode) {
      nativeRemoveChild.call(child.__ytafLink.parentNode, child.__ytafLink);
    }
    return nativeRemoveChild.call(this, child);
  };

  function addCobaltStyles() {
    var visuals = document.createElement('style');
    visuals.textContent = '.ytaf-vot-bar,.ytaf-vot-menu{box-shadow:none!important}';
    document.head.appendChild(visuals);
    var config = {};
    try {
      config = JSON.parse(localStorage.getItem('ytaf-configuration') || '{}');
    } catch (error) {
      config = {};
    }
    if (config.enableAdBlock === false) return;
    var style = document.createElement('style');
    style.textContent = 'ytlr-ad-slot-renderer,ytlr-tv-masthead-renderer{display:none!important}';
    document.head.appendChild(style);
  }

  function runUserScript() {
    addCobaltStyles();
    try {
