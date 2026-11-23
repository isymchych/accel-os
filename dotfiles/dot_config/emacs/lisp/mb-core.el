;;; mb-core.el --- Core defaults and personal commands -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(require 'mb-options)
(require 'use-package)

;; Core defaults

;; keep menu bar enabled only on mac since it doesn't take vertical space
(if (and
     (fboundp 'menu-bar-mode)
     mb-is-mac-os)
    (menu-bar-mode t))

(setq-default
 ;; scroll one line at a time (less "jumpy" than defaults)
 mouse-wheel-scroll-amount '(2 ((shift) . 2))
 ;; don't accelerate scrolling
 mouse-wheel-progressive-speed nil
 ;; scroll window under mouse
 mouse-wheel-follow-mouse 't)


(setq-default
 frame-title-format '(buffer-file-name "%f" ("%b"))

 ;; Reserve a row so LSP breadcrumbs can appear without shifting buffer text.
 header-line-format '("")

 ;; avoid some initial frame resizing to speed up startup
 frame-inhibit-implied-resize t

 ;; Don’t compact font caches during GC.
 inhibit-compacting-font-caches t

 ;; no beep and blinking
 visible-bell       nil
 ring-bell-function 'ignore

 ;; keyboard scroll one line at a time
 scroll-step 1

 ;; display column numbers in status line
 column-number-mode t
 ;; display line numbers in status line
 line-number-mode t
 ;; max line number to show
 line-number-display-limit 999999
 ;; max line width after which you will see ??? instead of line number
 line-number-display-limit-width 999999

 ;; draw underline lower
 x-underline-at-descent-line t

 ;; Show keystrokes in progress
 echo-keystrokes 0.1

 ;; hide empty lines after buffer end
 indicate-empty-lines nil

 font-lock-maximum-decoration t

 ;; skip duplicates from the kill-ring to simplify yanking
 kill-do-not-save-duplicates t

 ;; Don't prompt for confirmation when we create a new file or buffer (assume the
 ;; user knows what they're doing).
 confirm-nonexistent-file-or-buffer nil

 ;; middle-click paste at point, not at click
 mouse-yank-at-point t

 ;; do not break line even if its too long
 truncate-lines t
 truncate-partial-width-windows t)

;; use keyboard dialogs instead of popups
(setq use-dialog-box nil)
(tooltip-mode -1)

(blink-cursor-mode t)

;; take the short answer, y/n is yes/no
(setq use-short-answers t)

;; Keep directory-local evaluation behind Emacs' trust prompt.  Safe variables
;; can opt in through their `safe-local-variable' properties.
(setq enable-local-eval 'maybe
      enable-local-variables t)

;; Keep warnings visible so package/API breakage is discoverable.
(setq warning-minimum-level :warning)

;; Emacs 30 and newer: Disable Ispell completion function.
(setq text-mode-ispell-word-completion nil)

;; Emacs 28 and newer: Hide commands in M-x which do not apply to the current mode.
(setq read-extended-command-predicate #'command-completion-default-include-p)

;; make urls in comments/strings clickable
(add-hook 'find-file-hook 'goto-address-prog-mode)

;; highlight current line
(global-hl-line-mode t)

;; Enable disabled features
(put 'downcase-region           'disabled nil)
(put 'upcase-region             'disabled nil)
(put 'narrow-to-region          'disabled nil)

(setq-default
 ;; start scratch in text mode (usefull to get a faster Emacs load time
 ;; because it avoids autoloads of elisp modes)
 initial-major-mode 'text-mode

 ;; prevent creating backup files
 make-backup-files nil
 ;; prevent creating .save files
 auto-save-list-file-name nil
 ;; prevent auto saving
 auto-save-default nil
 create-lockfiles nil

 ;; Always rescan buffer for imenu
 imenu-auto-rescan t
 imenu-flatten t

 ;; Add ukrainian input method
 default-input-method "ukrainian-computer"

 ;; set default mode for unknown files
 major-mode 'text-mode

 ;; move files to trash when deleting
 delete-by-moving-to-trash t)

;; Encoding
(set-language-environment     'utf-8)
(set-default-coding-systems   'utf-8)
(setq locale-coding-system    'utf-8)
(set-terminal-coding-system   'utf-8)
(set-keyboard-coding-system   'utf-8)
(set-selection-coding-system  'utf-8)
(prefer-coding-system         'utf-8)

;; Transparently open compressed files
(auto-compression-mode t)

;; Delete-selection mode: delete selected text when typing
(delete-selection-mode t)

;; Electric indent mode: enable autoindent on enter etc.
(electric-indent-mode 1)


;; Tabs: use only spaces for indent
(setq-default
 indent-tabs-mode  nil
 tab-always-indent nil

 tab-width          mb-tab-size
 c-basic-offset     mb-tab-size
 py-indent-offset   mb-tab-size)

(setq-default
 ;; Sentences do not need double spaces to end
 sentence-end-double-space nil

 ;; lines should be 80 characters wide, not 72
 fill-column 80)


;; display margins in terminal emacs
(unless (display-graphic-p)
  (setq-default
   right-margin-width 1
   left-margin-width 1))


;; make sure emacs will try to split windows horizontally by default
(setq split-height-threshold nil)
(setq split-width-threshold 160)


;; Allow for minibuffer-ception. Sometimes we need another minibuffer command
;; while we're in the minibuffer.
(setq enable-recursive-minibuffers t)


;; Expand the minibuffer to fit multi-line text displayed in the echo-area
(setq resize-mini-windows 'grow-only)


;; Try to keep the cursor out of the read-only portions of the minibuffer.
(setq minibuffer-prompt-properties '(read-only t intangible t cursor-intangible t face minibuffer-prompt))
(add-hook 'minibuffer-setup-hook #'cursor-intangible-mode)


;; Default to soft line-wrapping in text modes. It is more sensibile for text
;; modes, even if hard wrapping is more performant.
(add-hook 'text-mode-hook #'visual-line-mode)


;; Continue comment to new line
(setq comment-multi-line t)


;; Repeat deeply nested commands
;; https://karthinks.com/software/it-bears-repeating/
(repeat-mode t)



;; Display a counter showing the number of the current and the other matches.
(setq isearch-lazy-count t)
(setq lazy-count-prefix-format "(%s/%s) ")

;; Make regular Isearch interpret the empty space as a regular
;; expression that matches any character between the words you give  it.
(setq search-whitespace-regexp ".*?")



;; Use rg for grep-find-command
(with-eval-after-load 'grep
  (grep-apply-setting
   'grep-find-command
   '("rg -n -H --no-heading -e '' $(git rev-parse --show-toplevel || pwd)" . 27)))



;; Personal commands



;; https://github.com/syl20bnr/spacemacs/blob/a58a7d79b3713bcf693bb61d9ba83d650a6aba86/core/core-funcs.el#L331
(defun mb/alternate-buffer (&optional window)
  "Switch back and forth between current and last buffer in the WINDOW."
  (interactive)
  (cl-destructuring-bind (buf start pos)
      (or (cl-find (window-buffer window) (window-prev-buffers)
		   :key #'car :test-not #'eq)
	  (list (other-buffer) nil nil))
    (if (not buf)
	(message "Last buffer not found.")
      (set-window-buffer-start-and-point window buf start pos))))


(defun mb/untabify-buffer ()
  "Replace tabs with spaces in buffer."
  (interactive)
  (untabify (point-min) (point-max))
  (message "mb: untabify buffer"))

(defun mb/indent-buffer ()
  "Reindent buffer."
  (interactive)
  (save-excursion
    (indent-region (point-min) (point-max) nil)))

(defun mb/cleanup-buffer ()
  "Perform a bunch of operations on the whitespace content of a buffer."
  (interactive)
  (mb/indent-buffer)
  (whitespace-cleanup)
  (message "mb: cleanup and indent buffer"))

(defun mb/rename-file-and-buffer ()
  "Renames current buffer and file it is visiting."
  (interactive)
  (let ((filename (buffer-file-name)))
    (if (not (and filename (file-exists-p filename)))
	(message "mb: Buffer is not visiting a file!")
      (let ((new-name (read-file-name "New name: "
				      (file-name-directory filename)
				      nil
				      nil
				      (file-name-nondirectory filename))))
        (cond
         ((vc-backend filename) (vc-rename-file filename new-name))
         (t
          (rename-file filename new-name t)
          (set-visited-file-name new-name t t)))))))

(defun mb/delete-current-buffer-file ()
  "Remove file connected to current buffer and kill buffer."
  (interactive)
  (let ((filename (buffer-file-name))
        (buffer (current-buffer)))
    (if (not (and filename (file-exists-p filename)))
	(ido-kill-buffer)
      (when (yes-or-no-p "Are you sure you want to remove this file? ")
        (delete-file filename)
        (kill-buffer buffer)
        (message "mb: File '%s' successfully removed" filename)))))

(defun mb/revert-buffer ()
  "Revert active buffer without asking."
  (interactive)
  (revert-buffer nil t t)
  (message (concat "Reverted buffer " (buffer-name))))


(defun mb/narrow-or-widen-dwim (p)
  "If the buffer is narrowed, it widens.  Otherwise, it narrows intelligently.
Intelligently means: region, subtree, or defun, whichever applies
first.

With prefix P, don't widen, just narrow even if buffer is already
narrowed."
  (interactive "P")
  (declare (interactive-only))
  (cond ((and (buffer-narrowed-p) (not p)) (widen))
	((region-active-p)
	 (narrow-to-region (region-beginning) (region-end)))
	((derived-mode-p 'org-mode) (org-narrow-to-subtree))
	(t (narrow-to-defun))))

(defun mb/display-ansi-colors ()
  "Replace ANSI escape chars with real colors in current buffer."
  (interactive)
  (ansi-color-apply-on-region (point-min) (point-max)))

(defun mb/eslint-fix-file ()
  "Fix some issues in current file using `npx eslint --fix'."
  (interactive)
  (message "mb: npx eslint --fix this file")
  (when (buffer-modified-p)
    (save-buffer))
  (shell-command (format "npx eslint --fix %s" (shell-quote-argument (buffer-file-name))))
  ;; revert buffer to see changes in FS
  (revert-buffer t t))


(defun mb/preview-markdown-buffer ()
  "Preview the current buffer as Markdown with `mb-preview'."
  (interactive)
  (unless (executable-find "mb-preview")
    (user-error "Mb-preview not found in PATH"))
  (let* ((source-name (or buffer-file-name (buffer-name)))
         (title (file-name-nondirectory source-name))
         (base-dir (file-name-as-directory
                    (expand-file-name
                     (file-name-directory (or buffer-file-name default-directory)))))
         (output-buffer (get-buffer-create "*mb-preview*")))
    (when (file-remote-p base-dir)
      (user-error "Mb-preview: remote directories are not supported: %s" base-dir))
    (with-current-buffer output-buffer
      (erase-buffer))
    (let ((process
           (make-process
            :name "mb-preview"
            :buffer output-buffer
            :command (list "mb-preview"
                           "--open"
                           "--title" title
                           "--base-dir" base-dir)
            :connection-type 'pipe
            :sentinel
            (lambda (process event)
              (unless (process-live-p process)
                (if (= 0 (process-exit-status process))
                    (message "mb-preview: opened preview")
                  (display-buffer (process-buffer process))
                  (message "mb-preview failed: %s"
			   (replace-regexp-in-string "[\n\r]+\\'" "" event))))))))
      (process-send-region process (point-min) (point-max))
      (process-send-eof process))))


;; spacemax implementation of kill-this-buffer
;; @see https://github.com/syl20bnr/spacemacs/pull/6225
(defun mb/kill-this-buffer ()
  "Kill the current buffer."
  (interactive)
  (if (window-minibuffer-p)
      (abort-recursive-edit)
    (kill-buffer (current-buffer))))


(defun mb/kill-window-or-quit ()
  "Close the current window or quit Emacs if it is the last main window."
  (interactive)
  (if (eq (selected-window) (window-main-window))
      (save-buffers-kill-emacs)
    (delete-window)))


(defun mb/get-selected-text ()
  "Return the currently selected text in the current buffer."
  (if (region-active-p)
      (buffer-substring (region-beginning) (region-end))
    ""))


(defvar-local mb-auto-fill-mode nil)
(defun mb/toggle-auto-fill-mode ()
  "Toggle auto-fill mode and fill indicator."
  (interactive)

  (setq mb-auto-fill-mode (not mb-auto-fill-mode))
  (message "mb/toggle-auto-fill-mode: %s" mb-auto-fill-mode)

  (let ((arg (if mb-auto-fill-mode 1 0)))
    (auto-fill-mode arg)
    (display-fill-column-indicator-mode arg)
    ))


(defun mb/change-font ()
  "Interactively select a font and make it the default on all frames and save it."
  (interactive)
  ;; run in a timer so that M-x interface have time to close before font picker is visible
  (run-with-timer
   0.15
   nil
   (lambda ()
     (when-let* ((new-font (if (fboundp 'x-select-font)
                               (x-select-font)
                             (mouse-select-font)))
                 (new-font-name (font-xlfd-name new-font)))
       (message "MB selected font: %s" new-font-name)
       (set-frame-font new-font-name nil t)
       (customize-save-variable 'mb-font new-font-name)))))


(defun mb/invoke-C-c ()
  "Invoke the active mode-specific command prefix."
  (interactive)
  (setq unread-command-events (listify-key-sequence "\C-c")))


(defun mb/open-xterm-here ()
  "Open xterm in `default-directory`."
  (interactive)
  (let ((dir default-directory))
    (when (file-remote-p dir)
      (user-error "Xterm: remote directory not supported: %s" dir))
    (unless (executable-find "xterm")
      (user-error "Xterm not found in PATH"))
    (let ((cwd (file-name-as-directory (expand-file-name dir))))
      (start-process "xterm" nil "xterm" "open" "--cwd" cwd))))

(defun mb/meta-return-dwim ()
  "Confirm minibuffer input, otherwise open xterm in current directory."
  (interactive)
  (if (active-minibuffer-window)
      (exit-minibuffer)
    (mb/open-xterm-here)))

;; Fix PATH on Mac
(use-package exec-path-from-shell
  ;; Not needed ATM since the emacs-plus injects path on build https://github.com/d12frosted/homebrew-emacs-plus#injected-path
  ;; :disabled https://github.com/d12frosted/homebrew-emacs-plus/issues/720
  :if mb-is-mac-os
  :config
  (exec-path-from-shell-initialize))


;; Uniquify: unique buffer names
(use-package uniquify
  :ensure nil
  :config
  (setq uniquify-buffer-name-style 'forward
	uniquify-separator "/"
	;; rename after killing uniquified
	uniquify-after-kill-buffer-p t
	;; don't muck with special buffers
	uniquify-ignore-buffers-re "^\\*"))



;; Recentf: save recent files
(use-package recentf
  :ensure nil
  :config
  (setq recentf-max-menu-items 25
	recentf-max-saved-items 1000
	;; cleanup non-existing files on startup
	;; may have problems with remote files
	recentf-auto-cleanup 'mode)

  ;; Ignore no-littering files
  (add-to-list 'recentf-exclude
	       (recentf-expand-file-name no-littering-var-directory))
  (add-to-list 'recentf-exclude
	       (recentf-expand-file-name no-littering-etc-directory))

  ;; Ignore ephemeral git commit message files
  (add-to-list 'recentf-exclude "/COMMIT_EDITMSG$")
  (add-to-list 'recentf-exclude "/elpa/")
  (add-to-list 'recentf-exclude ".recentf")
  (add-to-list 'recentf-exclude "/save-files/")

  (add-hook 'server-done-hook 'recentf-save-list)
  (add-hook 'server-visit-hook 'recentf-save-list)
  (add-hook 'delete-frame-hook 'recentf-save-list)

  (global-set-key (kbd "C-x C-r") 'recentf-open)

  (recentf-mode t)
  (recentf-track-opened-file))



;; Save search history
(use-package savehist
  :ensure nil
  :config
  (setq savehist-save-minibuffer-history t
	savehist-autosave-interval nil ; save on kill only
	savehist-additional-variables
	'(
	  mark-ring global-mark-ring       ; persist marks
	  search-ring regexp-search-ring)) ; persist searches

  (savehist-mode t))



;; Saveplace: save cursor position
(use-package saveplace
  :ensure nil
  :config
  (save-place-mode t))



;; Automatically update unmodified buffers whose files have changed.
(use-package autorevert
  :ensure nil
  :diminish auto-revert-mode
  :config
  (setq auto-revert-verbose t ; let us know when it happens
	auto-revert-use-notify nil
	auto-revert-stop-on-user-input nil
	;; Revert Dired and other buffers
	global-auto-revert-non-file-buffers t
	;; Only prompts for confirmation when buffer is unsaved.
	revert-without-query (list "."))
  (global-auto-revert-mode t))

(provide 'mb-core)
;;; mb-core.el ends here
