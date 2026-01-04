;;; init-evil.el --- evil config file -*- lexical-binding: t; -*-
;;; Commentary:
;; * Evil guide https://github.com/noctuid/evil-guide
;;; Code:

;; Evil: vim mode
(use-package evil
  ;; this must be set before loading evil
  :init
  (defvar evil-want-C-u-scroll nil)
  (defvar evil-want-Y-yank-to-eol t)
  (defvar evil-want-C-i-jump t)
  (defvar evil-want-keybinding nil) ;; needed for evil-collection
  (defvar evil-want-minibuffer t)
  (defvar evil-undo-system 'undo-fu)
  (defvar evil-lookup-func #'helpful-at-point)
  (defvar evil-disable-insert-state-bindings t)

  ;; enable subword mode CamelCase movement in evil
  ;; https://github.com/syl20bnr/spacemacs/blob/a58a7d79b3713bcf693bb61d9ba83d650a6aba86/layers/%2Bspacemacs/spacemacs-defaults/packages.el#L434
  (define-category ?U "Uppercase")
  (define-category ?u "Lowercase")
  (modify-category-entry (cons ?A ?Z) ?U)
  (modify-category-entry (cons ?a ?z) ?u)
  (make-variable-buffer-local 'evil-cjk-word-separating-categories)
  (add-hook 'subword-mode-hook
            (lambda ()
              (if subword-mode
                  (push '(?u . ?U) evil-cjk-word-separating-categories)
                (setq evil-cjk-word-separating-categories (default-value 'evil-cjk-word-separating-categories)))))
  :config
  (setq
   evil-shift-width mb-tab-size
   ;; more granular undo
   evil-want-fine-undo t
   evil-flash-delay 10
   ;; Don't wait for any other keys after escape is pressed.
   evil-esc-delay 0
   ;; h/l do not wrap around to next lines
   evil-cross-lines nil
   evil-want-visual-char-semi-exclusive t
   ;; do not move cursor back 1 position when exiting insert mode
   evil-move-cursor-back nil

   ;; It's infuriating that innocuous "beginning of line" or "end of line"
   ;; errors will abort macros, so suppress them:
   evil-kbd-macro-suppress-motion-error t

   ;; Only do highlighting in selected window so that Emacs has less work
   ;; to do highlighting them all.
   evil-ex-interactive-search-highlight 'selected-window

   ;; search for whole words not only for part
   evil-symbol-word-search 'symbol)

  ;; Exit to normal state after save
  (add-hook 'after-save-hook 'evil-normal-state)


  ;; PERF: Stop copying the selection to the clipboard each time the cursor
  ;; moves in visual mode. Why? Because on most non-X systems (and in terminals
  ;; with clipboard plugins like xclip.el active), Emacs will spin up a new
  ;; process to communicate with the clipboard for each movement. On Windows,
  ;; older versions of macOS (pre-vfork), and Waylang (without pgtk), this is
  ;; super expensive and can lead to freezing and/or zombie processes.
  ;;
  ;; UX: It also clobbers clipboard managers (see emacs-evil/evil#336).
  (setq evil-visual-update-x-selection-p nil)


  (evil-set-initial-state 'minibuffer-mode           'emacs)
  (evil-set-initial-state 'inferior-emacs-lisp-mode  'emacs)
  (evil-set-initial-state 'pylookup-mode             'emacs)
  (evil-set-initial-state 'term-mode                 'emacs)
  (evil-set-initial-state 'help-mode                 'emacs)
  (evil-set-initial-state 'grep-mode                 'emacs)
  (evil-set-initial-state 'bc-menu-mode              'emacs)
  (evil-set-initial-state 'rdictcc-buffer-mode       'emacs)
  (evil-set-initial-state 'comint-mode               'normal)
  (evil-set-initial-state 'wdired-mode               'normal)
  (evil-set-initial-state 'shell-mode                'insert)

  (evil-mode 1)

  ;; set leader key in all states
  (evil-set-leader nil (kbd "C-SPC"))

  ;; Use escape to quit, and not as a meta-key.
  (define-key evil-normal-state-map [escape] 'keyboard-quit)
  (define-key evil-visual-state-map [escape] 'keyboard-quit)
  (define-key evil-insert-state-map [escape] 'evil-normal-state)

  ;; Also quit with C-g
  (defun mb/evil-keyboard-quit ()
    "Keyboard quit and force normal state."
    (interactive)
    (and evil-mode (evil-force-normal-state))
    (keyboard-quit))

  (define-key evil-normal-state-map   (kbd "C-g") #'mb/evil-keyboard-quit)
  (define-key evil-motion-state-map   (kbd "C-g") #'mb/evil-keyboard-quit)
  (define-key evil-insert-state-map   (kbd "C-g") #'mb/evil-keyboard-quit)
  (define-key evil-window-map         (kbd "C-g") #'mb/evil-keyboard-quit)
  (define-key evil-operator-state-map (kbd "C-g") #'mb/evil-keyboard-quit)


  ;; disable man look up
  (define-key evil-motion-state-map "K" 'eldoc)
  (define-key evil-motion-state-map (kbd " ") nil)

  ;; Replace Emacs kill-ring-save with window management commands
  (global-set-key (kbd "M-w") 'evil-window-map)

  ;; insert tabs only in emacs state
  (define-key evil-emacs-state-map (kbd "TAB") #'indent-for-tab-command)

  ;; in many modes q is close/exit etc., so leave it unbound
  (define-key evil-normal-state-map "q" nil)
  (define-key evil-normal-state-map "Q" 'evil-record-macro)
  (define-key evil-window-map "q" 'evil-window-delete)

  (define-key evil-normal-state-map "gr" 'xref-find-references)
  (define-key evil-normal-state-map "gD" 'xref-find-definitions-other-window)

  (evil-define-key 'emacs minibuffer-mode-map
    ;; insert newline with Ctrl-Enter
    (kbd "C-<return>") 'newline
    (kbd "C-RET") 'newline
    (kbd "C-w") 'evil-delete-backward-word

    ;; make Enter work as expected in minibuffer default (emacs) state
    (kbd "<return>") 'exit-minibuffer
    (kbd "RET") 'exit-minibuffer)


  ;; Overload shifts so that they don't lose the selection
  ;; @see http://superuser.com/a/789156
  (defun mb/evil-shift-left-visual ()
    (interactive)
    (evil-shift-left (region-beginning) (region-end))
    (evil-normal-state)
    (evil-visual-restore))
  (defun mb/evil-shift-right-visual ()
    (interactive)
    (evil-shift-right (region-beginning) (region-end))
    (evil-normal-state)
    (evil-visual-restore))
  (define-key evil-visual-state-map (kbd ">") 'mb/evil-shift-right-visual)
  (define-key evil-visual-state-map (kbd "<") 'mb/evil-shift-left-visual)

  (global-set-key (kbd "C-c 2") 'call-last-kbd-macro)
  (global-set-key (kbd "M-g m") 'evil-show-marks)

  (evil-define-key '(normal visual) 'global (kbd "<SPC>") 'mb/invoke-C-c)

  (evil-define-key 'normal 'global
    (kbd "C-.") nil
    (kbd "C-,") nil))

;; integration of evil with various packages
(use-package evil-collection
  :after evil
  :init
  (setq
   evil-collection-setup-minibuffer t
   evil-collection-want-unimpaired-p nil)

  :config
  (evil-collection-init)

  (add-hook 'view-mode-hook
            (lambda ()
              (evil-collection-define-key 'normal 'view-mode-map
                " " 'nil)))

  (add-hook 'image-mode-hook
            (lambda ()
              (evil-collection-define-key 'normal 'image-mode-map
                " " 'nil)))

  (evil-collection-define-key 'normal 'dired-mode-map
    "h" 'mb/dired-up-directory
    "l" 'dired-find-file
    (kbd "RET") 'dired-find-alternate-file
    " " 'nil))


;; match visual selection with * and #
(use-package evil-visualstar
  :after evil
  :config
  (global-evil-visualstar-mode))

;; emulates surround.vim
(use-package evil-surround
  :after evil
  :config
  (global-evil-surround-mode 1))

;; match braces/tags with %
(use-package evil-matchit
  :after evil
  :config
  (global-evil-matchit-mode 1)
  (evil-add-command-properties #'evilmi-jump-items :jump t))

;; work with args in c-style functions
(use-package evil-args
  :after evil
  :init
  (define-key evil-inner-text-objects-map "a" 'evil-inner-arg)
  (define-key evil-outer-text-objects-map "a" 'evil-outer-arg))

;; text exchange operator (select, gx, select other word, gx)
(use-package evil-exchange
  :after evil
  :config
  (evil-exchange-install))

;; xml tag attribute as a text object (bound to x)
(use-package exato
  :after evil)

;; align text into columns - gl<space> or gL<space>
(use-package evil-lion
  :after evil
  :config
  (evil-lion-mode))



;; better-jumper
(with-eval-after-load 'better-jumper
  (global-set-key [remap evil-jump-forward]  #'better-jumper-jump-forward)
  (global-set-key [remap evil-jump-backward] #'better-jumper-jump-backward)

  (setq better-jumper-use-evil-jump-advice t))



;; comment-dwim-2
(define-key evil-normal-state-map "gc" 'comment-dwim-2)



;; vundo
(evil-define-key 'normal vundo-mode-map (kbd "<escape>") 'vundo-quit)



;; consult
(with-eval-after-load 'consult
  (global-set-key [remap evil-show-marks]     #'consult-mark)
  (global-set-key [remap evil-show-jumps]     #'evil-collection-consult-jump-list)
  (global-set-key [remap evil-show-registers] #'consult-register))


;; embark
(evil-define-key 'normal 'global (kbd "M-.") 'embark-act)


;; avy
(global-set-key [remap avy-goto-char-timer] 'evil-avy-goto-char-timer)
(global-set-key [remap avy-goto-line] 'evil-avy-goto-line)


;; company-mode
(with-eval-after-load 'company
  (add-hook 'evil-insert-state-exit-hook 'company-abort))


;; corfu
(with-eval-after-load 'corfu
  (mapc #'evil-declare-ignore-repeat
        '(corfu-next
          corfu-previous
          corfu-first
          corfu-last))

  (mapc #'evil-declare-change-repeat
        '(corfu-insert
          corfu-insert-exact
          corfu-complete)))



;; Anzu: show number of matches in mode-line while searching
(use-package anzu
  :diminish anzu-mode
  :bind (([remap query-replace] . anzu-query-replace)
         ([remap query-replace-regexp] . anzu-query-replace-regexp)
         :map isearch-mode-map
         ([remap isearch-query-replace] . anzu-isearch-query-replace)
         ([remap isearch-query-replace-regexp] . anzu-isearch-query-replace-regexp))
  :config
  (global-anzu-mode t))



;; evil-anzu: anzu integration for evil
(use-package evil-anzu
  :after evil)


;; which-key
(push '((nil . "\\`evil-") . (nil . "😈-")) which-key-replacement-alist)
(push '((nil . "\\`evil-collection-unimpaired-\\(.*\\)") . (nil . "😈-cu-\\1")) which-key-replacement-alist)


;; doom-modeline
(with-eval-after-load 'doom-modeline
  ;; show evil register macro while recording it
  (setq doom-modeline-always-show-macro-register t)

  ;; minibuffer colors for evil states https://emacs.stackexchange.com/a/76861
  (defun color-minibuffer (color)
    `(lambda ()
       (when (minibufferp)
         (face-remap-add-relative 'minibuffer-prompt :foreground ,color))))
  (add-hook 'evil-normal-state-entry-hook   (color-minibuffer (face-foreground 'doom-modeline-evil-normal-state nil t)))
  (add-hook 'evil-operator-state-entry-hook (color-minibuffer (face-foreground 'doom-modeline-evil-operator-state nil t)))
  (add-hook 'evil-insert-state-entry-hook   (color-minibuffer (face-foreground 'doom-modeline-evil-insert-state nil t)))
  (add-hook 'evil-replace-state-entry-hook  (color-minibuffer (face-foreground 'doom-modeline-evil-replace-state nil t)))
  (add-hook 'evil-visual-state-entry-hook   (color-minibuffer (face-foreground 'doom-modeline-evil-visual-state nil t)))
  (add-hook 'evil-motion-state-entry-hook   (color-minibuffer (face-foreground 'doom-modeline-evil-motion-state nil t)))
  (add-hook 'evil-emacs-state-entry-hook    (color-minibuffer (face-foreground 'doom-modeline-evil-emacs-state nil t)))
  )


;; expand-region
(with-eval-after-load 'expand-region
  (evil-add-command-properties #'er/expand-region :jump t)
  (evil-add-command-properties #'er/contract-region :jump t))



;; magit
(with-eval-after-load 'magit
  ;; make <leader> work in magit
  (define-key magit-mode-map (kbd "SPC") nil)
  (define-key magit-diff-mode-map (kbd "SPC") nil)

  ;; make M-w work in magit
  (define-key magit-mode-map (kbd "M-w") nil)

  ;; make M-tab work in magit status
  (evil-define-key 'normal magit-mode-map [M-tab] 'mb/alternate-buffer))


;; git-timemachine
(with-eval-after-load 'git-timemachine
  (evil-make-overriding-map git-timemachine-mode-map 'normal)
  ;; force update evil keymaps after git-timemachine-mode loaded
  (add-hook 'git-timemachine-mode-hook #'evil-normalize-keymaps))


;; diff-hl
(with-eval-after-load 'diff-hl
  ;; UX: Don't delete the current hunk's indicators while we're editing
  ;; https://github.com/doomemacs/doomemacs/blob/master/modules/ui/vc-gutter/config.el#L204
  (add-hook 'diff-hl-flydiff-mode-hook
            (defun +vc-gutter-init-flydiff-mode-h ()
              (if (not diff-hl-flydiff-mode)
                  (remove-hook 'evil-insert-state-exit-hook #'diff-hl-flydiff-update)
                (add-hook 'evil-insert-state-exit-hook #'diff-hl-flydiff-update)))))


;; Treemacs integration with evil
(use-package treemacs-evil
  :after (treemacs evil))


;; lsp-mode
(with-eval-after-load 'lsp-mode
  (add-hook 'lsp-mode-hook (lambda ()
                             (local-set-key [remap evil-goto-definition] 'lsp-find-definition)
                             )))


;; flycheck
(with-eval-after-load 'flycheck
  (evil-add-command-properties #'flycheck-first-error :jump t)
  (evil-add-command-properties #'flycheck-next-error :jump t)
  (evil-add-command-properties #'flycheck-previous-error :jump t))


;; flycheck-posframe
(with-eval-after-load 'flycheck-posframe
  ;; Don't display popups while in insert or replace mode, as it can affect
  ;; the cursor's position or cause disruptive input delays.
  (add-hook 'flycheck-posframe-inhibit-functions #'evil-insert-state-p)
  (add-hook 'flycheck-posframe-inhibit-functions #'evil-replace-state-p))


;; flymake
(with-eval-after-load 'flymake
  (evil-add-command-properties #'flymake-goto-next-error :jump t)
  (evil-add-command-properties #'flymake-goto-prev-error :jump t)

  (evil-define-key 'normal flymake-mode-map
    (kbd "M-e j") 'flymake-goto-next-error
    (kbd "M-e M-j") 'flymake-goto-next-error
    (kbd "M-e k") 'flymake-goto-prev-error
    (kbd "M-e l") 'flymake-show-project-diagnostics
    (kbd "M-e M-k") 'flymake-goto-prev-error
    (kbd "M-e b") 'flymake-start))


;; gptel
(with-eval-after-load 'gptel
  (add-hook 'gptel-pre-response-hook 'evil-normal-state))


;; justl
(with-eval-after-load 'justl
  (evil-define-key 'normal justl-mode-map
    (kbd "e")     'justl-exec-recipe
    (kbd "E")     'justl-exec-eshell
    (kbd "?")     'justl-help-popup))


(provide 'init-evil)
;;; init-evil.el ends here
