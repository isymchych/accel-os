;;; mb-ui.el --- Frames and visual interface -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(require 'mb-options)
(require 'use-package)

;; Nord theme https://github.com/arcticicestudio/nord-emacs
;; Solarized theme https://github.com/bbatsov/solarized-emacs

;; Doom emacs themes https://github.com/doomemacs/themes
(use-package doom-themes
  :config
  ;; Enable flashing mode-line on errors
  (doom-themes-visual-bell-config)

  ;; Corrects (and improves) org-mode's native fontification.
  (doom-themes-org-config))


;; Modus themes https://protesilaos.com/emacs/modus-themes
(use-package modus-themes
  :disabled
  :config
  (setq modus-themes-italic-constructs t
	modus-themes-bold-constructs nil)

  (setq modus-themes-common-palette-overrides
	(append
	 ;; Keep the border but make it the same color as the background of the
	 ;; mode line (thus appearing borderless).  The difference with the
	 ;; above is that this version is a bit thicker because the border are
	 ;; still there.
	 '((border-mode-line-active bg-mode-line-active)
           (border-mode-line-inactive bg-mode-line-inactive))

	 modus-themes-preset-overrides-faint)))



;; Auto dark mode on Linux https://darkman.grtcdr.tn/
(use-package darkman
  :if mb-is-linux

  :config
  (setq darkman-themes (list :light mb-light-theme :dark mb-dark-theme))
  (if (getenv "DBUS_SESSION_BUS_ADDRESS")
      (condition-case err
	  (darkman-mode)
	(dbus-error
         (message "Skipping darkman-mode: %s" (error-message-string err))))
    (message "Skipping darkman-mode: DBUS_SESSION_BUS_ADDRESS is unset")))



;; Auto dark mode on macOS
(use-package auto-dark
  :if mb-is-mac-os
  :diminish auto-dark-mode
  :init
  ;; HACK: remove the applescript support so that this package doesn't break in CLI mode
  (unless window-system
    (fmakunbound 'ns-do-applescript))
  :config
  (setq
   auto-dark-allow-osascript t
   auto-dark-dark-theme mb-dark-theme
   auto-dark-light-theme mb-light-theme)

  (auto-dark-mode t))



;; Spacious padding: add padding to windows
(use-package spacious-padding
  :config
  (spacious-padding-mode))



;; Nerd icons. Used by other packages. must use nerd font!
;; run M-x nerd-icons-install-fonts if icons are missing.
(use-package nerd-icons
  :defer t)



;; Nerd icons for dired
(use-package nerd-icons-dired
  :diminish nerd-icons-dired-mode
  :hook
  (dired-mode . nerd-icons-dired-mode))



;; Mode line
(use-package doom-modeline
  :config
  (setq doom-modeline-buffer-file-name-style 'truncate-with-project
	doom-modeline-minor-modes t
	doom-modeline-hud nil
	doom-modeline-buffer-encoding nil
	doom-modeline-env-version nil)

  (doom-modeline-mode 1))



;; Nyan mode: use nyan cat in mode line to indicate scroll position
(use-package nyan-mode
  :config
  (setq nyan-minimum-window-width 128)
  (nyan-mode))



;; Diminish: cleanup mode line
;; for :diminish in use-package
(use-package diminish
  :config
  (eval-after-load 'hi-lock
    '(diminish 'hi-lock-mode)))



;; writable grep, complementary package for other packages
(use-package wgrep
  :defer t
  :config
  (setq wgrep-auto-save-buffer t))



;; Show available keybindings in a separate window
(use-package which-key
  :ensure nil
  :diminish which-key-mode
  :bind (("C-h w"            . 'which-key-show-major-mode)
         ("C-h W"            . 'which-key-show-top-level))
  :init
  (setq
   which-key-allow-evil-operators t
   which-key-compute-remaps t
   which-key-allow-multiple-replacements t
   which-key-sort-order 'which-key-key-order-alpha)

  (which-key-mode)

  (push '(("RET" . nil) . ("⏎" . nil)) which-key-replacement-alist))



;; Helpful: a better *help* buffer
(use-package helpful
  :commands helpful--read-symbol
  :hook (helpful-mode . visual-line-mode)
  :init
  ;; Make `apropos' et co search more extensively. They're more useful this way.
  (setq apropos-do-all t)

  (global-set-key [remap describe-function] #'helpful-callable)
  (global-set-key [remap describe-command]  #'helpful-command)
  (global-set-key [remap describe-variable] #'helpful-variable)
  (global-set-key [remap describe-key]      #'helpful-key)
  (global-set-key [remap describe-symbol]   #'helpful-symbol))

(provide 'mb-ui)
;;; mb-ui.el ends here
