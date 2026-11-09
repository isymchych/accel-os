;;; check-emacs-startup.el --- Bootstrap isolated startup tests -*- lexical-binding: t; -*-
;;; Commentary:
;; Завантажуємо справжню конфігурацію, але зберігаємо стан лише в тимчасовому каталозі.
;;; Code:

(require 'emacs-project)
(require 'package)

(setq package-user-dir (expand-file-name package-user-dir)
      user-emacs-directory
      (file-name-as-directory
       (or (getenv "EMACS_TEST_DIRECTORY")
           (error "EMACS_TEST_DIRECTORY is not set")))
      custom-file (expand-file-name "custom.el" user-emacs-directory))

(when (fboundp 'startup-redirect-eln-cache)
  (startup-redirect-eln-cache (expand-file-name "eln-cache/" user-emacs-directory)))

(package-initialize)
(setenv "DBUS_SESSION_BUS_ADDRESS" nil)
(require 'no-littering)

(add-to-list 'load-path (expand-file-name "lisp" mb/emacs-project-config-dir))
(require 'mb-development)

;;; check-emacs-startup.el ends here
