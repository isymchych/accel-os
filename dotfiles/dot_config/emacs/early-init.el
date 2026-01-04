;;; early-init.el --- Startup speed, annoyance suppression -*- lexical-binding: t; -*-
;;; Commentary:
;;; Code:

(defcustom mb-font "Iosevka Fixed:weight=medium:size=17" "Default font to be used by Emacs. Use \\[mb/change-font] to customize." :type 'string :group 'mb-customizations)

;; redirect native compilation files into no-littering dir
(when (fboundp 'startup-redirect-eln-cache)
  (startup-redirect-eln-cache
   (convert-standard-filename
    (expand-file-name  "var/eln-cache/" user-emacs-directory))))


;; file to save customizations done through UI
(setq custom-file (expand-file-name "custom.el" user-emacs-directory))

;; load customizations file if it exists
(load custom-file t)


;; reduce the frequency of garbage collection by making it happen on
;; each 100MB of allocated data (the default is on every 0.76MB)
(setq gc-cons-threshold 100000000)

;; Increase the amount of data which Emacs reads from the process.
;; default is too low 4k considering that the some of the language server responses are in 800k - 3M range.
(setq read-process-output-max (* 1024 1024)) ;; 1mb

(setq byte-compile-warnings '(not obsolete))
(setq warning-suppress-log-types '((comp) (bytecomp)))
(setq native-comp-async-report-warnings-errors 'silent)

;; Silence stupid startup message
(setq inhibit-startup-echo-area-message (user-login-name))
;; disable startup screen
(setq inhibit-startup-screen t)
;; remove message from scratch
(setq initial-scratch-message nil)

;; Default frame configuration: full screen, good-looking title bar on macOS
(setq frame-resize-pixelwise t)

;; Turn off mouse interface early in startup to avoid momentary display
(if (fboundp 'tool-bar-mode)   (tool-bar-mode   -1))
(if (fboundp 'scroll-bar-mode) (scroll-bar-mode -1))
(if (fboundp 'menu-bar-mode)   (menu-bar-mode -1))

;; default styles for *ALL* windows
(setq default-frame-alist '((vertical-scroll-bars . nil)
                            (horizontal-scroll-bars . nil)

                            ;; Setting the face in here prevents flashes of
                            ;; color as the theme gets activated
                            ;; NOTE: its here because in initial-frame-alist it breaks consult M-x match color in dark theme
                            ;; it is going to be removed in init.el
                            (background-color . "#2e3440")

                            (ns-transparent-titlebar . t)))

;; default styles for *THE FIRST* window
(setq initial-frame-alist '((fullscreen . maximized)

                            ;; Setting the face in here prevents flashes of
                            ;; color as the theme gets activated
                            (foreground-color . "#cccccc")))

;; Font
(setq font-use-system-font nil)
(setq-default default-font mb-font)
(set-face-attribute 'default nil :font mb-font)

;; set font for all windows
(add-to-list 'default-frame-alist `(font . ,mb-font))

(message "Using font %s" mb-font)

;; Improve lsp-mode performance https://emacs-lsp.github.io/lsp-mode/page/performance/#use-plists-for-deserialization
;; disabled due to https://github.com/emacs-lsp/lsp-mode/issues/4059#issuecomment-1560520842
;; (setenv "LSP_USE_PLISTS" "true")

;;; early-init.el ends here
