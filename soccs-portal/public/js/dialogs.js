(() => {
  function showDialog(message, options = {}) {
    const {
      title = 'Notice',
      confirmText = 'OK',
      cancelText = '',
      danger = false
    } = options;

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay system-dialog-overlay open';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const panel = document.createElement('section');
      panel.className = 'fm system-dialog';
      const header = document.createElement('header');
      header.className = 'fm-head';
      const logo = document.createElement('img');
      logo.className = 'logo';
      logo.src = 'assets/logo.png';
      logo.alt = '';
      const organization = document.createElement('span');
      organization.className = 'org';
      organization.textContent = 'Student Organization of the College of Computer Studies (SOCCS)';
      const close = document.createElement('button');
      close.className = 'fm-close';
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      const closeIcon = document.createElement('img');
      closeIcon.src = 'assets/ekis.png';
      closeIcon.alt = '';
      close.append(closeIcon);
      header.append(logo, organization, close);

      const body = document.createElement('div');
      body.className = 'fm-body';
      const heading = document.createElement('h2');
      heading.className = 'fm-title grad-text system-dialog-title';
      heading.textContent = title;
      const content = document.createElement('div');
      content.className = 'fm-content system-dialog-content';
      const text = document.createElement('p');
      text.textContent = String(message ?? '');
      content.append(text);
      const actions = document.createElement('div');
      actions.className = 'switch-account-actions';

      const hasCancel = Boolean(cancelText);
      if (hasCancel) {
        const cancel = document.createElement('button');
        cancel.className = 'btn';
        cancel.type = 'button';
        cancel.textContent = cancelText;
        cancel.addEventListener('click', () => finish(false));
        actions.append(cancel);
      }

      const confirm = document.createElement('button');
      confirm.className = danger ? 'btn danger' : 'btn';
      confirm.type = 'button';
      confirm.textContent = confirmText;
      confirm.addEventListener('click', () => finish(true));
      actions.append(confirm);
      body.append(heading, content, actions);
      panel.append(header, body);
      overlay.append(panel);

      let completed = false;
      const onKeydown = event => {
        if (event.key === 'Escape') finish(false);
      };
      function finish(result) {
        if (completed) return;
        completed = true;
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(result);
      }

      close.addEventListener('click', () => finish(false));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener('keydown', onKeydown);
      document.body.append(overlay);
      confirm.focus();
    });
  }

  window.systemDialog = {
    alert(message, title = 'Notice') {
      return showDialog(message, { title });
    },
    confirm(message, options = {}) {
      return showDialog(message, {
        title: options.title || 'Please confirm',
        confirmText: options.confirmText || 'Continue',
        cancelText: options.cancelText || 'Cancel',
        danger: Boolean(options.danger)
      });
    }
  };
})();