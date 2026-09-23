;;; mb-development.el --- Programming languages and tooling -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(require 'mb-completion)
(require 'mb-core)
(require 'mb-navigation)
(require 'use-package)

;; Emacs shell
(use-package eshell
  :ensure nil
  :defer t
  :bind ("C-c E" . eshell))



;; Comint-mode: interact with REPLs
(use-package comint
  :ensure nil
  :no-require
  :init
  (setq ansi-color-for-comint-mode t
	comint-prompt-read-only t
	comint-buffer-maximum-size 2048))



;; Compilation mode
(use-package compile
  :ensure nil
  :no-require
  :init
  (setq compilation-always-kill t       ; kill compilation process before starting another
	compilation-ask-about-save nil  ; save all buffers on `compile' without prompting
	compilation-scroll-output 'first-error)

  (add-hook 'compilation-filter-hook #'ansi-color-compilation-filter)

  ;; Automatically truncate compilation buffers so they don't accumulate too
  ;; much data and bog down the rest of Emacs.
  (autoload 'comint-truncate-buffer "comint" nil t)
  (add-hook 'compilation-filter-hook #'comint-truncate-buffer))




;; Ediff: resolve merge conflicts
(use-package ediff
  :ensure nil
  :defer t
  :init
  (setq ediff-diff-options "-w" ; turn off whitespace checking
	ediff-split-window-function #'split-window-horizontally
	ediff-window-setup-function #'ediff-setup-windows-plain))



;; Makefile mode
(use-package makefile-mode
  :ensure nil
  :no-require t
  :init
  (defun mb/use-tabs ()
    "Use tabs."
    (setq tab-width        8
	  indent-tabs-mode 1))

  (add-hook 'makefile-mode-hook 'mb/use-tabs)
  (add-hook 'makefile-bsdmake-mode-hook 'mb/use-tabs))



;; SCSS-mode
(use-package scss-mode
  :ensure nil
  :mode ("\\.scss\\'" . scss-mode)
  :init
  ;; fix mode breaking due to missing flymake variables
  (setq flymake-allowed-file-name-masks nil
	flymake-err-line-patterns nil)
  :config
  (setq scss-compile-at-save nil)
  (message "mb: SCSS MODE"))



;; Python mode
(use-package python
  :ensure nil
  :disabled
  :interpreter ("python" . python-mode)
  :config
  (setq python-indent-offset mb-tab-size)
  (message "mb: PYTHON MODE"))



;; C-based languages like Java
(use-package cc-mode
  :ensure nil
  :mode
  ("\\.java\\'" . java-mode)
  :config
  ;; Set the default formatting styles for various C based modes.
  ;; Particularly, change the default style from GNU to Java.
  (setq c-default-style
	'((awk-mode . "awk")
	  (other . "java")))

  (add-hook 'java-mode-hook (lambda ()
                              ;; disable auto-indent
                              (electric-indent-local-mode 0)))

  (message "mb: CC MODE"))



;; XML
(use-package nxml-mode
  :ensure nil
  :mode ("\\.xml\\'" . nxml-mode)
  :mode ("\\.svg\\'" . nxml-mode)
  :config

  (setq nxml-child-indent  mb-tab-size)

  (message "mb: nXML MODE"))



;; Emacs Lisp
(use-package elisp-mode
  :ensure nil
  :init
  (add-hook 'emacs-lisp-mode-hook
	    (lambda()
	      (setq mode-name "ELisp")))
  (add-hook 'lisp-interaction-mode-hook
	    (lambda() (setq mode-name "λ"))))



;; Shell mode
(use-package sh-script
  :ensure nil
  :defer t
  :init
  ;; Use sh-mode when opening `.zsh' files, and when opening Prezto runcoms.
  (dolist (pattern '("\\.zsh\\'"
                     "zlogin\\'"
                     "zlogout\\'"
                     "zpreztorc\\'"
                     "zprofile\\'"
                     "zshenv\\'"
                     "zshrc\\'"))
    (add-to-list 'auto-mode-alist (cons pattern 'sh-mode)))
  :config
  (message "mb: SH MODE"))



;; Prefer built-in tree-sitter modes and install missing grammars on demand.
(use-package treesit
  :ensure nil
  :custom
  (treesit-enabled-modes t)
  (treesit-auto-install-grammar 'ask)
  (treesit-font-lock-level 4)
  :config
  (add-to-list 'auto-mode-alist '("\\.mts\\'" . typescript-ts-mode)))



;; Language server protocol
(use-package lsp-mode
  :diminish lsp-mode
  :defer t
  :hook
  ((tsx-ts-mode . lsp-deferred)
   (js-ts-mode . lsp-deferred)
   (typescript-ts-mode . lsp-deferred)
   (rust-ts-mode . lsp-deferred)
   (yaml-ts-mode . lsp-deferred)
   (html-ts-mode . lsp-deferred)
   (mhtml-ts-mode . lsp-deferred))
  :init
  (setq lsp-keymap-prefix "C-c C-l"
	lsp-idle-delay 0.6
	lsp-keep-workspace-alive nil
	lsp-disabled-clients '(tailwindcss)
	lsp-enable-suggest-server-download nil
	lsp-auto-execute-action nil

	lsp-diagnostics-provider :flycheck
	lsp-lens-enable nil
	;; Keep editor diagnostics aligned with this repository's Rust check.
	lsp-rust-analyzer-cargo-watch-command "clippy"

	lsp-completion-default-behaviour :insert
	lsp-completion-provider :capf
	lsp-completion-show-detail t
	lsp-completion-show-kind t

	lsp-modeline-code-actions-segments '(count name)

	lsp-eslint-server-command '("vscode-eslint-language-server" "--stdio")) ;; https://github.com/hrsh7th/vscode-langservers-extracted

  (setq lsp-volar-take-over-mode nil)
  (setq lsp-volar-hybrid-mode t)
  :config
  (add-to-list 'lsp-file-watch-ignored-directories "[/\\\\]\\.worktrees\\'")

  ;; lsp-mode supplies (inlineCompletion . ()); its JSON serializer emits null,
  ;; which tsgo rejects because textDocument.inlineCompletion must be an object.
  ;; Keep this until lsp-mode sends an object (or omits the capability).
  (defun mb/lsp-fix-inline-completion-capability (capabilities)
    "Encode inline completion client capability as an empty JSON object."
    (when-let* ((text-document-capabilities (alist-get 'textDocument capabilities))
                (inline-completion-entry (assq 'inlineCompletion text-document-capabilities)))
      (setcdr inline-completion-entry (make-hash-table :test 'equal)))
    capabilities)

  (advice-add 'lsp--client-capabilities
	      :filter-return #'mb/lsp-fix-inline-completion-capability)

  ;; lsp-mode's tsgo client resolves a system "tsgo" or its own downloaded
  ;; package.  An opted-in project instead uses its node_modules/.bin/tsc;
  ;; resolve that path per project without changing the default client.
  (defun mb/project-local-tsgo-command ()
    "Return the project-local TypeScript native LSP command."
    (unless mb-use-local-tsgo
      (user-error "Set mb-use-local-tsgo in .dir-locals.el to use project-local tsgo"))
    (let* ((tsc-relative-path "node_modules/.bin/tsc")
           (root (locate-dominating-file default-directory tsc-relative-path)))
      (unless root
        (user-error "Could not find %s from %s" tsc-relative-path default-directory))
      `(,(expand-file-name tsc-relative-path root) ,@lsp-clients-tsgo-args)))

  (defun mb/lsp-package-path (orig-fn dependency)
    "Use project-local TypeScript for lsp-mode's tsgo client when enabled."
    (if (and mb-use-local-tsgo (eq dependency 'tsgo))
	(car (mb/project-local-tsgo-command))
      (funcall orig-fn dependency)))

  (advice-add 'lsp-package-path :around #'mb/lsp-package-path)

  (defun mb/lsp-mode-setup-completion ()
    (setf (alist-get 'styles (alist-get 'lsp-capf completion-category-defaults))
	  '(orderless)))
  (add-hook 'lsp-completion-mode-hook #'mb/lsp-mode-setup-completion)

  (which-key-add-key-based-replacements "SPC l" "LSP")
  (add-hook 'lsp-mode-hook 'lsp-enable-which-key-integration)

  (defun mb/lsp-rust-analyzer-run-flycheck ()
    "Request fresh Clippy diagnostics when Rust Analyzer initializes a buffer."
    (when-let* ((workspace (car (lsp-workspaces))))
      (when (and (derived-mode-p 'rust-ts-mode)
		 (eq (lsp--workspace-server-id workspace) 'rust-analyzer))
        (lsp-notify "rust-analyzer/runFlycheck"
		    `(:textDocument ,(lsp--text-document-identifier))))))

  (add-hook 'lsp-managed-mode-hook #'mb/lsp-rust-analyzer-run-flycheck t)

  (add-hook 'lsp-mode-hook (lambda ()
                             (local-set-key [remap xref-find-references] 'lsp-find-references)

                             (local-set-key (kbd "C-c l a") 'lsp-execute-code-action)
                             (local-set-key (kbd "C-c l f") 'lsp-find-references)
                             (local-set-key (kbd "C-c l t") 'lsp-goto-type-definition)
                             (local-set-key (kbd "C-c l r") 'lsp-rename))))

;; lsp-mode reads unvisited xref targets with insert-file-contents-literally,
;; leaving UTF-8 bytes undecoded in xref summaries and consult-xref previews.
;; Scope decoded reads to this conversion until lsp-mode handles them itself.
(with-eval-after-load 'lsp-mode
  (defun mb/lsp-xref-read-files-decoded (orig-fn locations)
    "Force decoded reads in lsp xref temp buffers."
    (cl-letf (((symbol-function 'insert-file-contents-literally)
               (lambda (filename &optional visit beg end replace)
                 (let ((coding-system-for-read 'undecided))
                   (insert-file-contents filename visit beg end replace)))))
      (funcall orig-fn locations)))
  (advice-add 'lsp--locations-to-xref-items
	      :around #'mb/lsp-xref-read-files-decoded))



;; Flycheck: lint files
(use-package flycheck
  :diminish flycheck-mode
  :defer 1
  :init (global-flycheck-mode)
  :config
  (setq
   flycheck-check-syntax-automatically '(mode-enabled save)

   ;; Display errors a little quicker (default is 0.9s)
   flycheck-display-errors-delay 0.25

   flycheck-temp-prefix "FLYCHECK_XXY")

  (if (display-graphic-p)
      (setq flycheck-indication-mode 'right-fringe)
    (progn
      (setq flycheck-indication-mode 'right-margin)))

  (defun mb/flycheck-javascript-oxlint-working-directory (_checker)
    "Run oxlint from the nearest directory that owns `.oxlintrc.json`."
    (or (and buffer-file-name
             (locate-dominating-file buffer-file-name ".oxlintrc.json"))
	default-directory))

  (put 'javascript-oxlint
       'flycheck-working-directory
       #'mb/flycheck-javascript-oxlint-working-directory)

  ;; from Spacemacs
  (defun mb/toggle-flycheck-errors-list ()
    "Toggle flycheck's error list window."
    (interactive)
    (-if-let (window (flycheck-get-error-list-window))
	     (quit-window nil window)
	     (flycheck-list-errors))))


;; Flycheck-posframe: display flycheck error
(use-package flycheck-posframe
  :after flycheck
  :config
  (setq flycheck-posframe-border-width 2
	flycheck-posframe-position 'window-bottom-left-corner)

  ;; Don't display popups if company is open
  (add-hook 'flycheck-posframe-inhibit-functions #'company--active-p)

  (add-hook 'flycheck-mode-hook #'flycheck-posframe-mode))



;; Eat: terminal emulator
(use-package eat
  :hook (eshell-load . eat-eshell-mode)
  :bind ("C-c e" . eat)
  :config
  (setq eat-kill-buffer-on-exit t))



;; Run code formatters like Prettier
(use-package apheleia
  :diminish apheleia-mode
  :init
  (apheleia-global-mode +1)
  :config
  (defun mb-apheleia-disallowed-buffer-p ()
    (and buffer-file-name
	 (or (string-match-p "\\.component\\.html\\'" buffer-file-name)
             (string-equal (file-name-nondirectory buffer-file-name) "package.json"))))
  (add-to-list 'apheleia-inhibit-functions #'mb-apheleia-disallowed-buffer-p)
  (add-hook 'apheleia-post-format-hook 'flycheck-buffer)
  )



;; Justfile mode syntax
(use-package just-mode
  :defer t)

;; Run justfile recipes
(use-package justl
  :defer t
  :bind (
         :map project-prefix-map
         ("j" . justl)

         :map justl-mode-map
         ("?" . justl-help-popup)))


;; Markdown tree-sitter mode
(use-package markdown-ts-mode
  :ensure nil
  :mode ("\\.md\\'" . markdown-ts-mode)
  :hook (markdown-ts-mode . outline-minor-mode))



;; Lua mode
(use-package lua-mode
  :defer t
  :config
  (message "mb: LUA MODE"))



;; Groovy mode (for Jenkinsfile)
(use-package groovy-mode
  :disabled
  :defer t
  :config
  (message "mb: GROOVY MODE"))



;; Dockerfile mode
(use-package dockerfile-mode
  :defer t
  :config
  (message "mb: DOCKERFILE MODE"))



;; Graphql mode
(use-package graphql-mode
  :disabled
  :defer t
  :config
  (message "mb: GRAPHQL MODE"))



;; PKGBUILD mode
(use-package pkgbuild-mode
  :defer t
  :mode ("\\PKGBUILD.template\\'" . pkgbuild-mode)
  :config
  (message "mb: PKGBUILD MODE"))

(provide 'mb-development)
;;; mb-development.el ends here
