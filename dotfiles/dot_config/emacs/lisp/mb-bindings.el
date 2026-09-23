;;; mb-bindings.el --- Global personal keymaps -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(require 'mb-completion)
(require 'mb-core)
(require 'mb-development)
(require 'mb-editing)
(require 'mb-navigation)
(require 'mb-vc)

;; Global keybindings
;; http://xahlee.info/emacs/emacs/emacs_good_keybinding.html
;; http://xahlee.info/emacs/emacs_manual/elisp/Key-Binding-Conventions.html


(if (window-system)
    (progn
      ;; zoom in / zoom out in editor
      (global-set-key [C-mouse-4] 'text-scale-increase)
      (global-set-key [C-mouse-5] 'text-scale-decrease)

      (when mb-is-mac-os
	(global-set-key (kbd "C-<wheel-up>")   'text-scale-increase)
	(global-set-key (kbd "C-<wheel-down>") 'text-scale-decrease)))

  (progn
    ;; activate mouse-based scrolling
    (global-set-key (kbd "<mouse-4>") 'scroll-down-line)
    (global-set-key (kbd "<mouse-5>") 'scroll-up-line)))


;; disable input methods
(global-unset-key (kbd "C-\\"))

;; prevent accidentally closed frames (in emacsclient?)
(global-unset-key (kbd "C-x C-z")) ;; suspend-frame
(global-unset-key (kbd "C-z")) ;; suspend-frame

;; remove some Super- keybindings on mac
(global-set-key (kbd "s-t")     'nil)
(global-set-key (kbd "s-n")     'nil)

;; make M-tab work in terminal
(define-key input-decode-map [?\C-\M-i] [M-tab])
(global-set-key [M-tab]         'mb/alternate-buffer)


;; Use escape to quit, and not as a meta-key.
(define-key minibuffer-local-map            [escape] 'minibuffer-keyboard-quit)
(define-key minibuffer-local-ns-map         [escape] 'minibuffer-keyboard-quit)
(define-key minibuffer-local-completion-map [escape] 'minibuffer-keyboard-quit)
(define-key minibuffer-local-must-match-map [escape] 'minibuffer-keyboard-quit)
(define-key minibuffer-local-isearch-map    [escape] 'minibuffer-keyboard-quit)
(global-set-key [escape] 'keyboard-quit)

(global-set-key (kbd "C-x <escape>") 'keyboard-quit)
(global-set-key (kbd "C-c <escape>") 'keyboard-quit)

;; C-m automatically translates to RET, the next line prevents it
;; (define-key input-decode-map [?\C-m] [C-m])

;; ensure C-[ in GUI translates to <escape>
(define-key input-decode-map [?\C-\[] (kbd "<escape>"))

(global-set-key (kbd "C-x C-q") 'mb/kill-window-or-quit)

(global-set-key [remap kill-buffer] 'mb/kill-this-buffer)

(global-set-key (kbd "C-x C-M-t") 'transpose-regions)

(global-set-key [remap upcase-word]     'upcase-dwim)
(global-set-key [remap downcase-word]   'downcase-dwim)
(global-set-key [remap capitalize-word] 'capitalize-dwim)

(global-set-key (kbd "<f6>") 'mb/revert-buffer)

(global-set-key (kbd "M-RET")     'mb/meta-return-dwim)
(global-set-key (kbd "M-<return>") 'mb/meta-return-dwim)


(defvar-keymap mb/insert-map
  :doc "mb prefix map for inserting things"
  "s"  'yas-insert-snippet
  "e"  'emoji-search
  "c"  'insert-char)

(defvar-keymap mb/buffer-map
  :doc "mb prefix map for buffer things"
  "l"  'mb/cleanup-buffer
  "d"  'mb/delete-current-buffer-file
  "r"  'mb/rename-file-and-buffer
  "R"  'mb/revert-buffer
  "c"  'flycheck-buffer)

(defvar-keymap mb/git-map
  :doc "mb prefix map for git things"
  "s" 'magit-status
  "l" 'magit-log-buffer-file
  "b" 'magit-blame
  "t" 'git-timemachine
  "p" 'diff-hl-previous-hunk
  "n" 'diff-hl-next-hunk
  "r" 'diff-hl-revert-hunk
  "d" 'diff-hl-diff-goto-hunk)

(defvar-keymap mb/toggle-map
  :doc "mb prefix map for toggling things"
  "a" 'apheleia-mode
  "b" 'mb/speedbar-dwim
  "c" 'rainbow-mode
  "e" 'mb/toggle-flycheck-errors-list
  "f" 'mb/toggle-auto-fill-mode
  "m" 'menu-bar-mode
  "n" 'display-line-numbers-mode
  "s" 'scroll-lock-mode
  "v" 'mb/toggle-visual-fill-mode
  "w" 'whitespace-mode)

(defvar-keymap mb/dir-actions-map
  :doc "mb prefix map for Directory actions"
  "f"  'mb/consult-fd-in-current-dir
  "g"  'mb/consult-ripgrep-in-current-dir
  "s"  'mb/consult-ripgrep-in-current-dir
  "o"  'dired-jump-other-window)

(defvar-keymap mb/format-actions-map
  :doc "mb prefix map for Formatting actions"
  "<SPC>"  'just-one-space
  "s"      'sort-lines)

(defvar-keymap mb/local-actions-map
  :doc "mb prefix map for Local actions"
  "ESC" '("Exit & do nothing" . ignore))

;; define global bindings on C-c
(which-key-add-keymap-based-replacements mode-specific-map
  "B" `("Buffer"               . ,mb/buffer-map)
  "D" `("Dir actions"          . ,mb/dir-actions-map)
  "g" `("Git"                  . ,mb/git-map)
  "i" `("Insert"               . ,mb/insert-map)
  "l" `("Local-mode actions"   . ,mb/local-actions-map)
  "p" `("Project"              . ,project-prefix-map)
  "t" `("Toggle"               . ,mb/toggle-map)

  "=" `("Formatting"           . ,mb/format-actions-map))

(global-set-key (kbd "C-c b") 'switch-to-buffer)

(global-set-key (kbd "C-c j") 'avy-goto-char-timer)
(global-set-key (kbd "C-c d") 'dired-jump)
(global-set-key (kbd "C-c k") 'mb/kill-this-buffer)
(global-set-key (kbd "C-c n") 'mb/narrow-or-widen-dwim)
(global-set-key (kbd "C-c q") 'mb/kill-window-or-quit)
(global-set-key (kbd "C-c r") 'consult-recent-file)
(global-set-key (kbd "C-c s") 'save-buffer)
(global-set-key (kbd "C-c y") 'yank-from-kill-ring)

(which-key-add-key-based-replacements "C-c l" "Local actions")


(global-set-key (kbd "M-g w") 'other-window)

(provide 'mb-bindings)
;;; mb-bindings.el ends here
