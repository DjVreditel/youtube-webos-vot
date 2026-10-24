(function () {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  [Element.prototype, CharacterData.prototype, DocumentType.prototype].forEach(function (proto) {
    if (proto && !proto.remove) {
      proto.remove = function () {
        if (this.parentNode) this.parentNode.removeChild(this);
      };
    }
  });

  var textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  var nativeAppendChild = Node.prototype.appendChild;
  var nativeInsertBefore = Node.prototype.insertBefore;
  var nativeRemoveChild = Node.prototype.removeChild;

  function isStyle(node) {
    return node && node.nodeType === 1 && node.tagName === 'STYLE';
  }

  function refreshStyleLink(style) {
    var link = style.__ytafLink;
    var previous = link.href;
    link.href = URL.createObjectURL(new Blob([textContent.get.call(style) || ''], { type: 'text/css' }));
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

  Node.prototype.appendChild = function (child) {
    var result = nativeAppendChild.call(this, child);
    if (isStyle(child)) nativeAppendChild.call(document.head || this, linkFor(child));
    else if (isStyle(this) && this.__ytafLink) refreshStyleLink(this);
    return result;
  };
  Node.prototype.insertBefore = function (child, reference) {
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

  function runUserScript() {
    try {
