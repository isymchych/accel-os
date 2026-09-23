;;; mb-editing.el --- Text editing behavior -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(require 'mb-core)
(require 'use-package)

(use-package kmacro
  :ensure nil
  :config
  (defalias 'kmacro-insert-macro 'insert-kbd-macro)
  (define-key kmacro-keymap (kbd "i") #'kmacro-insert-macro))



;; dabbrev: autocomplete words based on buffer text
(use-package dabbrev
  :ensure nil
  :config
  ;; do not split words on _ and -
  (setq dabbrev-abbrev-char-regexp "[a-zA-Z0-9?!_\-]")

  (add-to-list 'dabbrev-ignored-buffer-modes 'doc-view-mode)
  (add-to-list 'dabbrev-ignored-buffer-modes 'pdf-view-mode)
  (add-to-list 'dabbrev-ignored-buffer-modes 'tags-table-mode))



;; hippie-expand: dabbrev on steroids
(use-package hippie-exp
  :ensure nil
  :config
  (setq hippie-expand-try-functions-list '(try-expand-dabbrev
                                           try-expand-dabbrev-all-buffers
                                           try-expand-dabbrev-from-kill
                                           try-complete-file-name-partially
                                           try-complete-file-name
                                           try-expand-all-abbrevs
                                           try-expand-list
                                           try-expand-line))

  (global-set-key [remap dabbrev-expand] 'hippie-expand))



;; Flyspell-mode: spell-checking on the fly as you type
(use-package flyspell
  :ensure nil
  :defer 1
  :diminish flyspell-mode
  :init
  (when (executable-find "aspell")
    (setq ispell-program-name "aspell") ; use aspell instead of ispell
    (setq ispell-dictionary "en_GB")
    (setq ispell-personal-dictionary (expand-file-name "aspell.en.pws" no-littering-var-directory))
    (setq-default ispell-extra-args '("--sug-mode=ultra"
                                      "--camel-case"))

    (defun mb/flyspell-select-personal-dictionary ()
      "Use a personal word list matching the buffer's Aspell dictionary."
      (let ((dictionary (or ispell-local-dictionary ispell-dictionary)))
        (setq-local ispell-local-pdict
                    (if (equal dictionary "en_GB")
                        ispell-personal-dictionary
                      (expand-file-name (format "aspell.%s.pws" dictionary)
                                        no-littering-var-directory)))
        (ispell-internal-change-dictionary)))

    (add-hook 'ispell-change-dictionary-hook #'mb/flyspell-select-personal-dictionary)
    (add-hook 'flyspell-mode-hook #'mb/flyspell-select-personal-dictionary))

  (add-hook 'text-mode-hook 'flyspell-mode)
  (add-hook 'prog-mode-hook (lambda ()
                              (setq flyspell-consider-dash-as-word-delimiter-flag t)
                              (flyspell-prog-mode)))

  :config
  ;; free up some bindings
  (define-key flyspell-mode-map (kbd "C-.") nil t)
  (define-key flyspell-mode-map (kbd "C-,") nil t)
  (define-key flyspell-mode-map (kbd "C-;") nil t)
  (define-key flyspell-mode-map (kbd "C-M-i") nil t)

  (global-set-key (kbd "M-<f8>")  'flyspell-buffer))



;; Subword-mode: navigate in CamelCase words
;; http://ergoemacs.org/emacs/emacs_subword-mode_superword-mode.html
(use-package subword
  :ensure nil
  :diminish subword-mode
  :init
  (global-subword-mode t))



;; Electric-pair mode: auto insert closing brackets
;; skip over and delete white space if it stands between the cursor and the closing delimiter
(use-package elec-pair
  :ensure nil
  :init
  (setq electric-pair-skip-whitespace 'chomp)
  :config
  (electric-pair-mode 1)
  (defun mb/emulate-disabled-electric-pair ()
    "Disable auto-inserting parens."
    (setq-local electric-pair-pairs nil)
    (setq-local electric-pair-text-pairs nil)
    (setq-local electric-pair-inhibit-predicate #'identity))
  (add-hook 'minibuffer-setup-hook 'mb/emulate-disabled-electric-pair))



;; Show parens mode: highlight matching parens
(use-package paren
  :ensure nil
  :config
  (setq show-paren-delay 0
	;; decrease overlay priority because
	;; it's higher than selection
	show-paren-priority 10
	;; highlight everything inside parens
	show-paren-style 'expression

	show-paren-highlight-openparen t
	show-paren-when-point-inside-paren t
	show-paren-when-point-in-periphery t)
  (show-paren-mode 1))



;; Eldoc: documentation messages
(use-package eldoc
  :ensure nil
  :diminish eldoc-mode
  :init
  (add-hook  'emacs-lisp-mode-hook        'turn-on-eldoc-mode)
  (add-hook  'lisp-interaction-mode-hook  'turn-on-eldoc-mode)
  (add-hook  'ielm-mode-hook              'turn-on-eldoc-mode))



;; Make clipboard work on all platforms
(use-package xclip
  :config
  (xclip-mode 1))



;; Translate Ukrainian OS-layout keys to their corresponding Emacs bindings
(use-package reverse-im
  :custom
  (reverse-im-input-methods '("ukrainian-computer"))
  :config
  (reverse-im-mode t))



;; Improved undo/redo system
(use-package undo-fu
  :init
  ;; increase emacs default undo limits
  (setq undo-limit 67108864) ;; 64mb.
  (setq undo-strong-limit 100663296) ;; 96mb.
  (setq undo-outer-limit 1006632960) ;; 960mb.

  (setq undo-fu-allow-undo-in-region t) ;; for better compatibility with meow

  :config
  (global-set-key [remap undo]      #'undo-fu-only-undo)
  (global-set-key [remap undo-redo] #'undo-fu-only-redo))


;; Save & restore undo/redo state
(use-package undo-fu-session
  :after undo-fu
  :config
  (setq undo-fu-session-compression 'zst
	undo-fu-session-incompatible-files '("\\.gpg$" "/COMMIT_EDITMSG\\'" "/git-rebase-todo\\'"))

  (global-undo-fu-session-mode))



;; Visualise the undo history
(use-package vundo
  :defer t
  :bind (("C-c u" . vundo))
  :config
  (setq vundo-glyph-alist vundo-unicode-symbols))



;; Surround things
(use-package surround
  :ensure t
  :bind-keymap ("M-'" . surround-keymap))



;; manage comments
(use-package comment-dwim-2
  :defer t
  :commands (comment-dwim-2)
  :bind
  (([remap comment-line] . 'comment-dwim-2)
   ([remap comment-dwim] . 'comment-dwim-2)))



;; YASnippet: snippets
(use-package yasnippet
  :defer t
  :diminish yas-minor-mode
  :commands (yas-hippie-try-expand yas-insert-snippet yas-visit-snippet-file yas-new-snippet)
  :init
  ;; expand snippets with hippie expand
  (add-to-list 'hippie-expand-try-functions-list 'yas-hippie-try-expand)

  :config
  (setq
   yas-verbosity          2
   yas-wrap-around-region t)

  ;; Remove GUI dropdown prompt (prefer ivy/helm)
  (delq 'yas-dropdown-prompt yas-prompt-functions)

  ;; disable `yas-expand` on TAB
  (define-key yas-minor-mode-map (kbd "<tab>") nil)
  (define-key yas-minor-mode-map (kbd "TAB") nil))

(use-package consult-yasnippet
  :defer t
  :commands (consult-yasnippet consult-yasnippet-visit-snippet-file)
  :init
  (global-set-key [remap yas-insert-snippet]     'consult-yasnippet)
  (global-set-key [remap yas-visit-snippet-file] 'consult-yasnippet-visit-snippet-file))

(use-package yasnippet-snippets
  :after (yasnippet)
  :diminish yas-minor-mode
  :config
  (yasnippet-snippets-initialize)
  (yas-global-mode))



;; Correct word at point
(use-package flyspell-correct
  :defer t
  :commands (flyspell-correct-at-point)
  :init
  (global-set-key [f8]    'flyspell-correct-at-point))



;; EditorConfig
(use-package editorconfig
  :ensure nil
  :diminish editorconfig-mode
  :config
  (add-hook 'prog-mode-hook 'editorconfig-apply)
  (add-hook 'text-mode-hook 'editorconfig-apply))

;; Highlight all matches of the word under the cursor
(use-package highlight-thing
  :defer t
  :diminish highlight-thing-mode
  :init
  (defun mb-highlight-thing-enable-unless-lsp ()
    (unless (bound-and-true-p lsp-mode)
      (require 'highlight-thing)
      (highlight-thing-mode 1)))
  (defun mb-highlight-thing-disable-for-lsp ()
    (when (bound-and-true-p highlight-thing-mode)
      (highlight-thing-mode -1)))
  (add-hook 'prog-mode-hook #'mb-highlight-thing-enable-unless-lsp)
  (with-eval-after-load 'lsp-mode
    (add-hook 'lsp-mode-hook #'mb-highlight-thing-disable-for-lsp))

  :custom
  (highlight-thing-exclude-thing-under-point t)
  (highlight-thing-delay-seconds 1.5))



;; Expand-region: expand selection like C-w in intellij idea
(use-package expand-region
  :defer t
  :bind (("C-c w" . er/expand-region))
  :init
  (setq expand-region-contract-fast-key "W"
	expand-region-reset-fast-key    "r"))



;; Rainbow-mode: highlight colors in text (e.g "red" or #3332F3)
(use-package rainbow-mode
  :defer t
  :hook ((web-mode . rainbow-mode)
         (css-mode . rainbow-mode)
         (scss-mode . rainbow-mode)
         (js-mode . rainbow-mode))
  :diminish rainbow-mode)



;; Rainbow delimiters
(use-package rainbow-delimiters
  :defer t
  :init
  (add-hook 'prog-mode-hook 'rainbow-delimiters-mode))



;; Indent-bars: highlight indentation
(use-package indent-bars
  :hook ((yaml-mode yaml-ts-mode prog-mode html-ts-mode) . indent-bars-mode)
  :init
  (if (not (package-installed-p 'indent-bars))
      (package-vc-install "https://github.com/jdtsmith/indent-bars"))
  :config
  ;; NOTE: emacs-plus on mac doens't support :stipple face https://github.com/d12frosted/homebrew-emacs-plus/issues/622
  ;; NOTE: emacs@29 with PGTK doens't display :stipples correctly (fixed in 30) https://github.com/jdtsmith/indent-bars/issues/3
  (setq indent-bars-prefer-character
	(or mb-is-mac-os
	    (and mb-is-linux (< emacs-major-version 30))))

  (setq
   indent-bars-color '(highlight :face-bg t :blend 0.2)
   indent-bars-pattern "."
   indent-bars-width-frac 0.1
   indent-bars-pad-frac 0.1
   indent-bars-zigzag nil
   indent-bars-color-by-depth nil
   indent-bars-highlight-current-depth nil
   indent-bars-display-on-blank-lines nil))



;; Visual-fill-column: visually wrap lines at fill-column instead of window margin
(use-package visual-fill-column
  :commands (visual-fill-column-mode)
  :init
  (setq-default
   visual-fill-column-center-text t
   visual-fill-column-enable-sensible-window-split t)

  (defvar-local mb-visual-fill-mode nil)
  (defun mb/toggle-visual-fill-mode ()
    "Toggle visual-fill mode."
    (interactive)

    (setq mb-visual-fill-mode (not mb-visual-fill-mode))
    (message "mb/toggle-visual-fill-mode: %s" mb-visual-fill-mode)

    (let ((arg (if mb-visual-fill-mode 1 0)))
      (visual-fill-column-mode arg)
      (visual-line-mode arg)))

  :config
  (advice-add 'text-scale-adjust :after #'visual-fill-column-adjust))



;; highlight todos
(use-package hl-todo
  :defer t
  :init (add-hook 'prog-mode-hook 'hl-todo-mode))

(provide 'mb-editing)
;;; mb-editing.el ends here
