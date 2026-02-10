;;; init.el --- main emacs config file -*- lexical-binding: t; -*-
;;; Commentary:
;; * Spacemacs https://github.com/syl20bnr/spacemacs
;; * Doom Emacs https://github.com/doomemacs/doomemacs
;;; Code:



;;; ---------------------------------------- VARS


(defvar mb-is-mac-os (eq system-type 'darwin))
(defvar mb-is-linux (eq system-type 'gnu/linux))

(defvar mb-light-theme 'doom-one-light)
(defvar mb-dark-theme 'doom-one)

(defvar mb-tab-size 4)

(defcustom mb-use-company t "Use company-mode for autocomplete." :type 'boolean :group 'mb-customizations)
(defcustom mb-use-corfu nil "Use corfu for autocomplete." :type 'boolean :group 'mb-customizations)


;; see https://platform.openai.com/api-keys
(defcustom mb-openai-api-key nil "An OpenAI API key to be used by packages." :type 'string :group 'mb-customizations)

(defcustom mb-editor nil "Which keybindings to use. Evil by default." :type 'string :group 'mb-customizations)
(setq mb-editor (or mb-editor (getenv "MB_EMACS_EDITOR") "evil"))
(message "EDITOR MODE: %s" mb-editor)



;;; ---------------------------------------- INIT



(if (native-comp-available-p)
    (message "Native compilation enabled!")
  (warn "Native compilation not enabled!"))


(require 'package)

;; this is needed to install use-package
(add-to-list 'package-archives
             '("melpa" . "https://melpa.org/packages/") t)

(setq package-enable-at-startup nil)
(setq package-install-upgrade-built-in t)

(package-initialize)

(eval-when-compile
  (require 'use-package)

  (require 'use-package-ensure)
  (setq use-package-always-ensure t))

(setq use-package-verbose t)

(require 'bind-key) ; for :bind in use-package

;; no-littering: organize emacs temporary files
(use-package no-littering
  :config
  ;; https://github.com/emacscollective/no-littering/pull/221
  (setq treesit--install-language-grammar-out-dir-history (list (no-littering-expand-var-file-name "tree-sitter/")))
  (setq treesit-extra-load-path          (list (no-littering-expand-var-file-name "tree-sitter/"))))


;; NOTE: the background-color was added in early-init.el but should be removed
;; to avoid discrepancies in background color in new frames
(setq default-frame-alist (assq-delete-all 'background-color default-frame-alist))



;;; ---------------------------------------- CONFIG

;; keep menu bar enabled only on mac since it doesn't take vertical space
(if (and
     (fboundp 'menu-bar-mode)
     mb-is-mac-os)
    (menu-bar-mode t))

;; Terminal mouse support
(unless window-system
  (require 'mouse)
  (xterm-mouse-mode t)
  (defun track-mouse (e)))

(setq-default
 ;; scroll one line at a time (less "jumpy" than defaults)
 mouse-wheel-scroll-amount '(2 ((shift) . 2))
 ;; don't accelerate scrolling
 mouse-wheel-progressive-speed nil
 ;; scroll window under mouse
 mouse-wheel-follow-mouse 't)


(setq-default
 frame-title-format '(buffer-file-name "%f" ("%b"))

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
 color-theme-is-global t

 ;; Don't defer screen updates when performing operations.
 redisplay-dont-pause t

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

;; do not ask if I want to execute `eval' from dir-locals
(setq enable-local-eval t)
;; do not ask if I want to set variables from dir-locals
(setq enable-local-variables :all)

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



;;; ---------------------------------------- UTILS



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
  "Fix some issues in current file using `eslint --fix'."
  (interactive)
  (message "mb: eslint --fix this file")
  (when (buffer-modified-p)
    (save-buffer))
  (shell-command (concat "eslint --fix " (buffer-file-name)))
  ;; revert buffer to see changes in FS
  (revert-buffer t t))


;; spacemax implementation of kill-this-buffer
;; @see https://github.com/syl20bnr/spacemacs/pull/6225
(defun mb/kill-this-buffer ()
  "Kill the current buffer."
  (interactive)
  (if (window-minibuffer-p)
      (abort-recursive-edit)
    (kill-buffer (current-buffer))))


(defun mb/kill-window-or-quit ()
  "Close the current window or quit Emacs if it's the last window."
  (interactive)
  (if (one-window-p)
      (save-buffers-kill-emacs)
    (delete-window)))


(defun mb/js-to-json ()
  "Convert JS value into JSON."
  (interactive)
  (save-excursion
    (shell-command-on-region (mark) (point) "node-transform 'x => JSON.stringify(eval(`(${x})`), null, 2)'" (buffer-name) t "*MB ERROR BUFFER*" t)))

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
     (when-let ((new-font (if (fboundp 'x-select-font)
                              (x-select-font)
                            (mouse-select-font)))
                (new-font-name (font-xlfd-name new-font)))
       (message "MB selected font: %s" new-font-name)
       (set-frame-font new-font-name nil t)
       (customize-save-variable 'mb-font new-font-name)))))


;; https://emacs.stackexchange.com/a/2471
(defun mb/invoke-C-c ()
  "Simulate pressing C-c."
  (interactive)
  (setq unread-command-events (listify-key-sequence "\C-c")))


(defun mb/open-xterm-here ()
  "Open xterm in `default-directory`."
  (interactive)
  (let ((dir default-directory))
    (when (file-remote-p dir)
      (user-error "xterm: remote directory not supported: %s" dir))
    (unless (executable-find "xterm")
      (user-error "xterm not found in PATH"))
    (let ((cwd (file-name-as-directory (expand-file-name dir))))
      (start-process "xterm" nil "xterm" "open" "--cwd" cwd))))

(defun mb/meta-return-dwim ()
  "Confirm minibuffer input, otherwise open xterm in current directory."
  (interactive)
  (if (active-minibuffer-window)
      (exit-minibuffer)
    (mb/open-xterm-here)))


;;; ---------------------------------------- ESSENTIAL PACKAGES



;; Fix PATH on Mac
(use-package exec-path-from-shell
  ;; Not needed ATM since the emacs-plus injects path on build https://github.com/d12frosted/homebrew-emacs-plus#injected-path
  ;; :disabled https://github.com/d12frosted/homebrew-emacs-plus/issues/720
  :if mb-is-mac-os
  :config
  (exec-path-from-shell-initialize))





;;; ---------------------------------------- BUILT-IN PACKAGES



;; kmacro: record macros
;; https://www.masteringemacs.org/article/keyboard-macros-are-misunderstood
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



;; Project.el: project management
(use-package project
  :ensure nil
  :config
  (push '(project-dired "Root directory") project-switch-commands)

  ;; Improve detection of project root https://andreyor.st/posts/2022-07-16-project-el-enhancements/
  (defcustom project-root-markers
    '("Cargo.lock" ".git" ".emacs-project")
    "Files or directories that indicate the root of a project."
    :type '(repeat string)
    :group 'project)

  (defun project-root-p (path)
    "Check if the current PATH has any of the project root markers."
    (catch 'found
      (dolist (marker project-root-markers)
        (when (file-exists-p (concat path marker))
          (throw 'found marker)))))

  (defun project-find-root (path)
    "Search up the PATH for `project-root-markers'."
    (when-let ((root (locate-dominating-file path #'project-root-p)))
      (cons 'transient (expand-file-name root))))

  (add-to-list 'project-find-functions #'project-find-root))



;; Flyspell-mode: spell-checking on the fly as you type
(use-package flyspell
  :ensure nil
  :defer 1
  :diminish flyspell-mode
  :init
  (when (executable-find "aspell")
    (setq ispell-program-name "aspell") ; use aspell instead of ispell
    (setq ispell-personal-dictionary (expand-file-name "aspell.en.pws" no-littering-var-directory))
    (setq-default ispell-extra-args '("--sug-mode=ultra"
                                      "--lang=en_GB"
                                      "--camel-case")))

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



;; Dired extensions
(use-package dired-x
  :ensure nil
  :config
  ;; Use GNU ls as `gls' from `coreutils' if available.  Add `(setq
  ;; dired-use-ls-dired nil)' to your config to suppress the Dired warning when
  ;; not using GNU ls.  We must look for `gls' after `exec-path-from-shell' was
  ;; initialized to make sure that `gls' is in `exec-path'
  (when mb-is-mac-os
    (let ((gls (executable-find "gls")))
      (when gls
        (setq insert-directory-program gls))))

  (setq dired-listing-switches "-aBhl  --group-directories-first")

  (add-hook 'dired-mode-hook 'dired-hide-details-mode)

  (put 'dired-find-alternate-file 'disabled nil)

  (setq dired-auto-revert-buffer t)    ; automatically revert buffer

  (defun mb/dired-up-directory ()
    "Take dired up one directory, but behave like dired-find-alternate-file."
    (interactive)
    (let ((old (current-buffer)))
      (dired-up-directory)
      (kill-buffer old)))

  (defun mb/dired-find-file-or-alternate ()
    "In Dired, open directories with `dired-find-alternate-file' and files with `dired-find-file'."
    (interactive)
    (let ((file (dired-get-file-for-visit)))
      (if (file-directory-p file)
          (dired-find-alternate-file)
        (dired-find-file))))

  (define-key dired-mode-map (kbd "h")                  'mb/dired-up-directory)
  (define-key dired-mode-map [remap dired-up-directory] 'mb/dired-up-directory)
  (define-key dired-mode-map [remap quit-window]        'mb/kill-this-buffer)

  (define-key dired-mode-map [remap dired-find-file] 'dired-find-alternate-file)
  (define-key dired-mode-map (kbd "l") 'dired-find-alternate-file)
  (define-key dired-mode-map (kbd "L") 'mb/dired-find-file-or-alternate)
  (define-key dired-mode-map (kbd "RET") 'dired-find-alternate-file)

  (global-set-key [remap dired]          'dired-jump)
  (global-set-key [remap list-directory] 'dired-jump))



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
        compilation-ask-about-save nil  ; save all buffers on `compile'
        compilation-save-buffers-predicate (lambda () nil)
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



;;; ---------------------------------------- 3rd PARTY PACKAGES



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



;; Make clipboard work on all platforms
(use-package xclip
  :config
  (xclip-mode 1))



;; sync emacs input mode with OS keyboard layout
(use-package reverse-im
  :custom
  (reverse-im-input-methods '("ukrainian-computer"))
  :config
  (reverse-im-mode t))



;; Improved undo/redo system
(use-package undo-fu
  :init
  ;; increase emacs default undo limits
  (setq undo-limit 6710886400) ;; 64mb.
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



;; better jump list
(use-package better-jumper
  :diminish better-jumper-local-mode
  :init
  (global-set-key [remap xref-pop-marker-stack] #'better-jumper-jump-backward)
  (global-set-key [remap xref-go-back] #'better-jumper-jump-backward)
  (global-set-key [remap xref-go-forward] #'better-jumper-jump-forward)

  :config
  (setq better-jumper-use-savehist t)

  (better-jumper-mode 1))



;; Goto last change
(use-package goto-chg
  :bind
  (("C-," . goto-last-change)
   ("C-." . goto-last-change-reverse)))



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



;; Vertical completion UI (like ido)
(use-package vertico
  :init
  (vertico-mode)

  (setq
   ;; Show more candidates
   vertico-count 20
   ;; enable cycling for `vertico-next' and `vertico-previous'.
   vertico-cycle t)

  (add-hook 'minibuffer-setup-hook #'vertico-repeat-save)

  (define-key vertico-map (kbd "M-j") 'vertico-next)
  (define-key vertico-map (kbd "M-k") 'vertico-previous)

  (global-set-key (kbd "C-c `") #'vertico-repeat))



;; Fuzzy matching algorithm
(use-package orderless
  :init
  (defun without-if-bang (pattern _index _total)
    (cond
     ((equal "!" pattern)
      '(orderless-literal . ""))
     ((string-prefix-p "!" pattern)
      `(orderless-without-literal . ,(substring pattern 1)))))

  (setq completion-styles '(basic orderless)
        ;; orderless-matching-styles '(orderless-regexp)
        orderless-style-dispatchers '(without-if-bang)
        completion-category-defaults nil
        completion-category-overrides '((file (styles partial-completion)))))



;; Enable rich annotations in the minibuffer
(use-package marginalia
  :init
  (marginalia-mode))



;; Advanced commands in vertical completion UI
(use-package consult
  :init
  (setq
   consult-preview-key (list :debounce 1 'any)
   register-preview-delay 0.5
   register-preview-function #'consult-register-format)

  ;; This adds thin lines, sorting and hides the mode line of the window.
  (advice-add #'register-preview :override #'consult-register-window)

  ;; Use Consult to select xref locations with preview
  (setq xref-show-xrefs-function #'consult-xref
        xref-show-definitions-function #'consult-xref)

  :config
  (setq
   consult-line-numbers-widen t
   consult-async-min-input 2
   consult-async-refresh-delay  0.15
   consult-async-input-throttle 0.2
   consult-async-input-debounce 0.1
   consult-narrow-key "C-+")

  ;; use consult instead of the standard *Completions* buffer
  (setq completion-in-region-function #'consult-completion-in-region)

  ;; These commands are problematic and automatically show the *Completions* buffer
  (advice-add #'tmm-add-prompt :after #'minibuffer-hide-completions)
  (advice-add #'ffap-menu-ask :around (lambda (&rest args)
                                        (cl-letf (((symbol-function #'minibuffer-completion-help)
                                                   #'ignore))
                                          (apply args))))


  ;; make narrowing help available in the minibuffer.
  ;; You may want to use `embark-prefix-help-command' or which-key instead.
  (define-key consult-narrow-map (vconcat consult-narrow-key "?") #'consult-narrow-help)

  ;;  consult-outline support for eshell prompts
  (add-hook 'eshell-mode-hook (lambda () (setq outline-regexp eshell-prompt-regexp)))

  ;; (setq consult-fd-args "fd --color=never")

  (defun mb/consult-ripgrep-symbol-at-point (&optional dir)
    (interactive)
    (consult-ripgrep dir (if (region-active-p)
                             (mb/get-selected-text)
                           (thing-at-point 'symbol))))

  (defun mb/consult-ripgrep-in-current-dir ()
    (interactive)
    (consult-ripgrep default-directory))

  (defun mb/consult-fd-thing-at-point (&optional dir)
    (interactive)
    (consult-fd dir (if (region-active-p)
                        (mb/get-selected-text)
                      (thing-at-point 'filename))))

  (defun mb/consult-fd-in-current-dir ()
    (interactive)
    (consult-fd default-directory))


  ;; remap existing commands
  (global-set-key [remap execute-extended-command-for-buffer] #'consult-mode-command)
  (global-set-key [remap apropos]                             #'consult-apropos)
  (global-set-key [remap bookmark-jump]                       #'consult-bookmark)
  (global-set-key [remap goto-line]                           #'consult-goto-line)
  (global-set-key [remap imenu]                               #'consult-imenu)
  (global-set-key [remap locate]                              #'consult-locate)
  (global-set-key [remap load-theme]                          #'consult-theme)
  (global-set-key [remap man]                                 #'consult-man)
  (global-set-key [remap recentf-open-files]                  #'consult-recent-file)
  (global-set-key [remap recentf-open]                        #'consult-recent-file)
  (global-set-key [remap list-buffers]                        #'consult-buffer)
  (global-set-key [remap switch-to-buffer]                    #'consult-buffer)
  (global-set-key [remap switch-to-buffer-other-window]       #'consult-buffer-other-window)
  (global-set-key [remap yank-pop]                            #'consult-yank-pop)
  (global-set-key [remap yank-from-kill-ring]                 #'consult-yank-from-kill-ring)
  (global-set-key [remap project-switch-to-buffer]            #'consult-project-buffer)
  (global-set-key [remap project-list-buffers]                #'consult-project-buffer)
  (global-set-key [remap project-find-file]                   #'consult-fd)
  (global-set-key [remap project-or-external-find-file]       #'mb/consult-fd-thing-at-point)
  (global-set-key [remap project-find-regexp]                 #'consult-ripgrep)
  (global-set-key [remap project-or-external-find-regexp]     #'mb/consult-ripgrep-symbol-at-point)

  (global-set-key (kbd "M-g M-l") #'consult-line)
  (global-set-key (kbd "M-g o")   #'consult-outline)

  (define-key project-prefix-map (kbd "s") #'consult-ripgrep) ;; override project-shell, for convenience
  (define-key project-prefix-map (kbd "S") #'mb/consult-ripgrep-symbol-at-point)

  (advice-add #'multi-occur :override #'consult-multi-occur))


;; jump to project
(use-package consult-jump-project
  :after consult
  :defer t
  :commands (consult-jump-project)
  :init
  (if (not (package-installed-p 'consult-jump-project))
      (package-vc-install "https://github.com/jdtsmith/consult-jump-project"))
  (global-set-key [remap project-switch-project] #'consult-jump-project))


;; Jump to Flycheck error
(use-package consult-flycheck
  :after (consult flycheck)
  :defer t
  :commands (consult-flycheck)
  :bind
  (("M-g e" . 'consult-flycheck)))


;; Nerd icons for consult / completion
(use-package nerd-icons-completion
  :after marginalia
  :config
  (nerd-icons-completion-mode)
  (add-hook 'marginalia-mode-hook #'nerd-icons-completion-marginalia-setup))



;; Context commands for things at a point
(use-package embark
  :commands (embark-act)
  :bind
  (("C-h B" . 'embark-bindings-at-point)
   ("M-." .  'embark-act))

  :config
  ;; Optionally replace the key help with a completing-read interface
  (setq prefix-help-command #'embark-prefix-help-command)

  ;; Hide the mode line of the Embark live/completions buffers
  (add-to-list 'display-buffer-alist
               '("\\`\\*Embark Collect \\(Live\\|Completions\\)\\*"
                 nil
                 (window-parameters (mode-line-format . none)))))



(use-package embark-consult
  :after (embark consult)
  ;; if you want to have consult previews as you move around an
  ;; auto-updating embark collect buffer
  :hook
  (embark-collect-mode . consult-preview-at-point-mode))



;; https://github.com/oantolin/embark/wiki/Additional-Configuration#use-which-key-like-a-key-menu-prompt
(use-package embark-which-key
  :ensure nil
  :no-require t
  :after (embark which-key)
  :config
  (defun embark-which-key-indicator ()
    "An embark indicator that displays keymaps using which-key.
The which-key help message will show the type and value of the
current target followed by an ellipsis if there are further
targets."
    (lambda (&optional keymap targets prefix)
      (if (null keymap)
          (which-key--hide-popup-ignore-command)
        (which-key--show-keymap
         (if (eq (plist-get (car targets) :type) 'embark-become)
             "Become"
           (format "Act on %s '%s'%s"
                   (plist-get (car targets) :type)
                   (embark--truncate-target (plist-get (car targets) :target))
                   (if (cdr targets) "…" "")))
         (if prefix
             (pcase (lookup-key keymap prefix 'accept-default)
               ((and (pred keymapp) km) km)
               (_ (key-binding prefix 'accept-default)))
           keymap)
         nil nil t (lambda (binding)
                     (not (string-suffix-p "-argument" (cdr binding))))))))

  (setq embark-indicators
        '(embark-which-key-indicator
          embark-highlight-indicator
          embark-isearch-highlight-indicator))

  (defun embark-hide-which-key-indicator (fn &rest args)
    "Hide the which-key indicator immediately when using the completing-read prompter."
    (which-key--hide-popup-ignore-command)
    (let ((embark-indicators
           (remq #'embark-which-key-indicator embark-indicators)))
      (apply fn args)))

  (advice-add #'embark-completing-read-prompter
              :around #'embark-hide-which-key-indicator))


;; Rg: search using ripgrep
(use-package rg
  :defer t
  :commands (rg-menu rg-isearch-menu rg-project)
  :init
  ;; ensure rg-isearch-menu is loaded
  (with-eval-after-load 'rg-menu
    (require 'rg-isearch))

  (global-set-key (kbd "M-s g") 'rg-menu)
  (global-set-key (kbd "M-s G") 'rg-isearch-menu)
  (define-key project-prefix-map (kbd "R") 'rg-project))



;; Avy: jump to char/line
(use-package avy
  :config
  ;; FIXME
  ;; (advice-add #'avy-goto-char-timer :around #'better-jumper-set-jump)
  ;; (advice-add #'avy-goto-line :around #'better-jumper-set-jump)

  (global-set-key [remap goto-char] 'avy-goto-char-timer)
  (global-set-key (kbd "M-g l") 'avy-goto-line))



;; Company-mode: autocomplete
(use-package company
  :if mb-use-company
  :defer 0.5
  :diminish company-mode
  :config
  (setq
   company-idle-delay                0.15
   company-tooltip-limit             20
   company-tooltip-align-annotations t
   company-minimum-prefix-length     1
   company-echo-delay                0
   company-selection-wrap-around     t

   company-insertion-triggers        nil

   company-dabbrev-ignore-case       nil
   company-dabbrev-downcase          nil

   company-require-match             nil
   company-show-quick-access        'left
   company-transformers             '(delete-dups)

   company-backends '((company-files
                       company-keywords
                       company-capf
                       company-dabbrev-code
                       company-dabbrev)))

  (defun mb/use-custom-matching-style (fn &rest args)
    "Use custom completion style specifically for the company-capf."
    (let ((orderless-matching-styles '(orderless-literal orderless-flex)))
      (apply fn args)))

  (advice-add #'company-capf :around #'mb/use-custom-matching-style)

  (eval-after-load 'eldoc
    (eldoc-add-command 'company-complete-selection
                       'company-complete-common
                       'company-capf
                       'company-abort))

  (global-company-mode 1)

  ;; Make TAB always complete the current selection, instead of
  ;; only completing a common prefix.
  (define-key company-active-map (kbd "<tab>") #'company-complete-selection)
  (define-key company-active-map (kbd "TAB") #'company-complete-selection)

  (define-key company-active-map (kbd "<return>") #'company-complete-selection)
  (define-key company-active-map (kbd "RET") #'company-complete-selection)

  ;; https://emacs.stackexchange.com/a/24800
  ;; <return> is for windowed Emacs; RET is for terminal Emacs
  ;; (dolist (key '("<return>" "RET"))
  ;;   ;; Here we are using an advanced feature of define-key that lets
  ;;   ;; us pass an "extended menu item" instead of an interactive
  ;;   ;; function. Doing this allows RET to regain its usual
  ;;   ;; functionality when the user has not explicitly interacted with
  ;;   ;; Company.
  ;;   (define-key company-active-map (kbd key)
  ;;               `(menu-item nil company-complete
  ;;                           :filter ,(lambda (cmd)
  ;;                                      (when (or (company-explicit-action-p)
  ;;                                                ;; or if previewing just one completion candidate
  ;;                                                (eq company-candidates-length 1))
  ;;                                        cmd)))))

  (define-key company-active-map (kbd "<f1>") nil)

  (define-key company-active-map (kbd "C-w") nil)
  (define-key company-active-map (kbd "C-j") nil)
  (define-key company-active-map (kbd "C-s")  nil)
  (define-key company-active-map (kbd "M-l")  'company-show-location)
  (define-key company-active-map [remap scroll-down-command]  nil)
  (define-key company-active-map [remap scroll-up-command]  nil))


;; Company-shell: better autocomplete in shell
(use-package company-shell
  :if mb-use-company
  :after (company sh-script)
  :config
  (setq company-shell-dont-fetch-meta mb-is-mac-os) ;; fixes slowdown on mac https://github.com/Alexander-Miller/company-shell/issues/15
  (add-to-list 'company-backends 'company-shell))


;; Company-quickhelp: show docs for a candidate in a tooltip
;; NOTE: change tooltip font size on Mac: defaults write org.gnu.Emacs NSToolTipsFontSize -int 14
(use-package company-quickhelp
  :if mb-use-company
  :after company
  :bind (:map company-active-map ("M-h" . #'company-quickhelp-manual-begin))
  :config
  (setq company-quickhelp-delay nil)
  (company-quickhelp-mode))



;; Completion-at-point (CAPF)
;; M-SPC during completion allows to filter candidates
;; M-g during completion shows candidate source
;; M-h during completion shows candidate documentation
;; NOTE: Feels "slow" comparing to company; has visual glitches
;; TODO: configure multiple completion sources
(use-package corfu
  :if mb-use-corfu
  :config
  (setq corfu-cycle t
        corfu-auto t
        corfu-auto-delay 0.1
        corfu-auto-prefix 1
        corfu-scroll-margin 5
        corfu-indexed-start 1
        corfu-count 16
        corfu-max-width 120
        corfu-on-exact-match nil)
  (global-corfu-mode)
  (corfu-indexed-mode)
  (corfu-popupinfo-mode)

  (corfu-history-mode 1)
  (add-to-list 'savehist-additional-variables 'corfu-history)

  ;; https://github.com/minad/corfu#completing-in-the-eshell-or-shell
  (add-hook 'eshell-mode-hook
            (lambda ()
              (setq-local corfu-auto nil)
              (corfu-mode)))

  (defun corfu-send-shell (&rest _)
    "Send completion candidate when inside comint/eshell."
    (cond
     ((and (derived-mode-p 'eshell-mode) (fboundp 'eshell-send-input))
      (eshell-send-input))
     ((and (derived-mode-p 'comint-mode)  (fboundp 'comint-send-input))
      (comint-send-input))))

  (advice-add #'corfu-insert :after #'corfu-send-shell)

  (global-set-key (kbd "M-p") 'completion-at-point))

(use-package cape
  :if mb-use-corfu
  :after (corfu)
  :config

  ;; https://github.com/minad/corfu/issues/188#issuecomment-1148658471
  ;; https://github.com/emacs-lsp/lsp-mode/issues/3555
  (advice-add #'lsp-completion-at-point :around #'cape-wrap-noninterruptible))



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
  :diminish editorconfig-mode
  :config
  (add-hook 'prog-mode-hook 'editorconfig-apply)
  (add-hook 'text-mode-hook 'editorconfig-apply))



;; Show available keybindings in a separate window
(use-package which-key
  :diminish which-key-mode
  :bind (("C-h w"            . 'which-key-show-major-mode)
         ("C-h W"            . 'which-key-show-top-level))
  :init
  (setq
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



;; Highlight all matches of the word under the cursor
(use-package highlight-thing
  :defer t
  :diminish highlight-thing-mode
  :config
  (defun mb-highlight-thing-enable-unless-lsp ()
    (unless (bound-and-true-p lsp-mode)
      (highlight-thing-mode 1)))
  (defun mb-highlight-thing-disable-for-lsp ()
    (when highlight-thing-mode
      (highlight-thing-mode -1)))
  (add-hook 'prog-mode-hook #'mb-highlight-thing-enable-unless-lsp)
  (with-eval-after-load 'lsp-mode
    (add-hook 'lsp-mode-hook #'mb-highlight-thing-disable-for-lsp))

  (setq highlight-thing-exclude-thing-under-point t)
  (setq highlight-thing-delay-seconds 1.5))



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



;; Transient: menus, used by magit and other packages
(use-package transient
  :config
  ;; Close transient with ESC
  (define-key transient-map [escape] #'transient-quit-one))



;; Magit: UI for git
(use-package magit
  :defer t
  :commands (magit-status magit-log-all magit-log-buffer-file magit-blame)
  :config
  (setq vc-follow-symlinks nil

        ;; ask me if I want to include a revision when rewriting
        magit-rewrite-inclusive 'ask
        ;; ask me to save buffers
        magit-save-some-buffers t
        ;; pop the process buffer if we're taking a while to complete
        magit-process-popup-time 10
        ;; don't show " MRev" in modeline
        magit-auto-revert-mode-lighter ""
        magit-push-always-verify nil

        ;; max length of first line of commit message
        git-commit-summary-max-length 72

        ;; ask me if I want a tracking upstream
        magit-set-upstream-on-push 'askifnotset

        transient-default-level 5
        transient-display-buffer-action '(display-buffer-below-selected)

        magit-bury-buffer-function #'magit-restore-window-configuration

        magit-diff-refine-hunk t ; show granular diffs in selected hunk
        ;; Don't display parent/related refs in commit buffers; they are rarely
        ;; helpful and only add to runtime costs.
        magit-revision-insert-related-refs nil)

  (add-hook 'git-commit-mode-hook
            (lambda ()
              (setq-local fill-column git-commit-summary-max-length)
              (mb/toggle-auto-fill-mode)))

  (add-hook 'magit-process-mode-hook #'goto-address-mode)

  (message "mb: initialized MAGIT"))



;; Git-modes: modes for .gitattributes, .gitconfig and .gitignore
(use-package git-modes
  :defer t)



;; Git-diff mode
(use-package diff-mode
  :defer t
  :config
  (define-key diff-mode-map (kbd "j") 'diff-hunk-next)
  (define-key diff-mode-map (kbd "k") 'diff-hunk-prev))



;; Difftastic: syntax-aware diffs
(use-package difftastic
  :ensure t
  :defer t)



;; Git-timemachine: browse through file history
(use-package git-timemachine
  :defer t)



;; Diff-hl: highlight changes in gutter
(use-package diff-hl
  :defer 0.5
  :config
  (setq diff-hl-draw-borders nil)
  (add-hook 'dired-mode-hook 'diff-hl-dired-mode)

  (add-hook 'magit-pre-refresh-hook  'diff-hl-magit-pre-refresh)
  (add-hook 'magit-post-refresh-hook 'diff-hl-magit-post-refresh)

  (diff-hl-flydiff-mode)

  ;; there is no fringe in terminal emacs, so use margins
  (unless (display-graphic-p)
    (diff-hl-margin-mode))

  (global-diff-hl-mode))



;; Casual-avy: transient bindings for avy
(use-package casual-avy
  :ensure t
  :bind ("M-g a" . casual-avy-tmenu))



;; Download tree-sitter grammars
(use-package treesit-auto
  :custom
  (treesit-auto-install 'prompt)
  :config
  (setq treesit-font-lock-level 4)
  ;; (setq treesit-language-source-alist (treesit-auto--build-treesit-source-alist))
  ;; (message "treesit-auto: %s languages" (length treesit-language-source-alist))
  ;; Don't use 'all here: some treesit-auto recipes intentionally have no file
  ;; pattern (e.g. phpdoc/jsdoc), which would add (nil . MODE) entries.
  (treesit-auto-add-to-auto-mode-alist)
  (setq auto-mode-alist (seq-filter #'car-safe auto-mode-alist))
  (global-treesit-auto-mode)

  (add-to-list 'auto-mode-alist '("\\.mts\\'" . typescript-ts-mode))

  (add-hook 'tsx-ts-mode-hook #'lsp-deferred)
  (add-hook 'js-ts-mode-hook #'lsp-deferred)
  (add-hook 'typescript-ts-mode-hook #'lsp-deferred)
  (add-hook 'rust-ts-mode-hook #'lsp-deferred)
  (add-hook 'yaml-ts-mode-hook #'lsp-deferred) ;; https://github.com/redhat-developer/yaml-language-server
  (add-hook 'html-ts-mode-hook #'lsp-deferred) ;; https://github.com/angular/vscode-ng-language-service
  )



;; Language server protocol
(use-package lsp-mode
  :diminish lsp-mode
  :defer t
  :init
  (setq lsp-keymap-prefix "C-c C-l"
        lsp-idle-delay 0.6
        lsp-keep-workspace-alive nil
        lsp-enable-suggest-server-download nil
        lsp-auto-execute-action nil

        lsp-diagnostics-provider :flycheck
        lsp-lens-enable nil

        lsp-completion-default-behaviour :insert
        lsp-completion-provider (if mb-use-company :capf :none)
        lsp-completion-show-detail t
        lsp-completion-show-kind t

        lsp-modeline-code-actions-segments '(count name)

        lsp-eslint-server-command '("vscode-eslint-language-server" "--stdio")) ;; https://github.com/hrsh7th/vscode-langservers-extracted

  (setq lsp-volar-take-over-mode nil)
  (setq lsp-volar-hybrid-mode t)
  :config
  (when mb-use-company
    (defun mb/lsp-mode-setup-completion ()
      (setf (alist-get 'styles (alist-get 'lsp-capf completion-category-defaults))
            '(orderless)))
    (add-hook 'lsp-completion-mode  'mb/lsp-mode-setup-completion))

  (which-key-add-key-based-replacements "SPC l" "LSP")
  (add-hook 'lsp-mode-hook 'lsp-enable-which-key-integration)

  (add-hook 'lsp-mode-hook (lambda ()
                             (local-set-key [remap xref-find-references] 'lsp-find-references)

                             (local-set-key (kbd "C-c l a") 'lsp-execute-code-action)
                             (local-set-key (kbd "C-c l f") 'lsp-find-references)
                             (local-set-key (kbd "C-c l t") 'lsp-goto-type-definition)
                             (local-set-key (kbd "C-c l r") 'lsp-rename))))



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

  (global-set-key [remap previous-error] 'flycheck-previous-error)
  (global-set-key [remap next-error]     'flycheck-next-error)

  (flycheck-add-mode 'javascript-eslint 'html-ts-mode)
  (add-hook 'html-ts-mode-hook
            (lambda ()
              (setq-local flycheck-checker 'javascript-eslint)
              (flycheck-mode)))

  ;; from Spacemacs
  (defun mb/toggle-flyckeck-errors-list ()
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
  (when mb-use-company
    (add-hook 'flycheck-posframe-inhibit-functions #'company--active-p))

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



;; Gptel: interact with chatgpt and other LLMs
(use-package gptel
  :disabled
  :if mb-openai-api-key
  :custom
  ((gptel-api-key mb-openai-api-key)
   (gptel-max-tokens 2500)
   (gptel-model "gpt-4o"))
  :bind ("C-x C-a" . 'gptel-send)
  :config
  (define-key gptel-mode-map (kbd "C-c l m")      'gptel-menu)

  (define-key gptel-mode-map (kbd "C-c C-c")    'gptel-send)
  (define-key gptel-mode-map (kbd "M-RET")      'gptel-send)
  (define-key gptel-mode-map (kbd "M-<return>") 'gptel-send))



;; Codeium: AI autocomplete
(use-package codeium
  :disabled
  :init
  (if (not (package-installed-p 'codeium))
      (package-vc-install "https://github.com/Exafunction/codeium.el"))
  :config
  ;; get codeium status in the modeline
  (setq codeium-mode-line-enable
        (lambda (api) (not (memq api '(CancelRequest Heartbeat AcceptCompletion)))))
  (add-to-list 'mode-line-misc-info '(:eval (car-safe codeium-mode-line)) t)
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


;; Markdown
(use-package markdown-mode
  :defer t
  :config
  (add-hook 'markdown-mode-hook 'flyspell-mode)
  (message "mb: MARKDOWN MODE"))

;; Markdown treesit mode
(use-package markdown-ts-mode
  :disabled
  :mode ("\\.md\\'" . markdown-ts-mode)
  :defer t
  :config
  (add-hook 'markdown-ts-mode-hook 'flyspell-mode)
  (message "mb: MARKDOWN-TS MODE"))



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



;;; ---------------------------------------- GLOBAL KEYBINDINGS
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
  "c" 'rainbow-mode
  "e" 'mb/toggle-flyckeck-errors-list
  "f" 'mb/toggle-auto-fill-mode
  "m" 'menu-bar-mode
  "n" 'display-line-numbers-mode
  "s" 'scroll-lock-mode
  "v" 'mb/toggle-visual-fill-mode
  "w" 'whitespace-mode)

(defvar-keymap mb/ai-map
  :doc "mb prefix map for AI things"
  "e"  'gptel-send
  "k"  'gptel-abort
  "g"  'gptel)

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
  "a" `("AI"                   . ,mb/ai-map)
  "B" `("Buffer"               . ,mb/buffer-map)
  "D" `("Dir actions"          . ,mb/dir-actions-map)
  "g" `("Git"                  . ,mb/git-map)
  "i" `("Insert"               . ,mb/insert-map)
  "l" `("Local-mode actions"   . ,mb/local-actions-map)
  "p" `("Project"              . ,project-prefix-map)
  "t" `("Toggle"               . ,mb/toggle-map)

  "=" `("Formatting"           . ,mb/format-actions-map))

(global-set-key (kbd "C-c b") 'switch-to-buffer)

(global-set-key (kbd "C-c d") 'dired-jump)
(global-set-key (kbd "C-c k") 'mb/kill-this-buffer)
(global-set-key (kbd "C-c n") 'mb/narrow-or-widen-dwim)
(global-set-key (kbd "C-c q") 'mb/kill-window-or-quit)
(global-set-key (kbd "C-c r") 'consult-recent-file)
(global-set-key (kbd "C-c s") 'save-buffer)
(global-set-key (kbd "C-c y") 'yank-from-kill-ring)

(which-key-add-key-based-replacements "C-c l" "Local actions")


(global-set-key (kbd "M-g w") 'other-window)



;; Personal boon config
(use-package init-boon
  :ensure nil
  :if (string= mb-editor "boon")
  :init
  (load (expand-file-name "init-boon" user-emacs-directory)))



;; Personal meow config
(use-package init-meow
  :ensure nil
  :if (string= mb-editor "meow")
  :init
  (load (expand-file-name "init-meow" user-emacs-directory)))



;; Personal evil config
(use-package init-evil
  :ensure nil
  :if (string= mb-editor "evil")
  :init
  (load (expand-file-name "init-evil" user-emacs-directory)))



;; TODO codeium
;; TODO dap-mode
;; TODO combobulate for tree-sitter-based navigation
;; TODO replace treemacs with dirvish
;; TODO configure registers consult
;; TODO consult-info to search for emacs help
;; TODO fix avy & better-jumper integration
;; FIXME emacs variable width fonts look bad & very small (i.e. in emacs manual info buffers)
;; TODO repeat-mode
;; FIXME modify consult-fd-args to ignore project prefix
;; TODO modalka-mode
;; TODO custom modal editing system? https://llazarek.github.io/blog/2018/07/modal-editing-in-emacs.html


(provide 'init)
;;; init.el ends here
