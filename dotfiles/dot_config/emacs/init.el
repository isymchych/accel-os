;;; init.el --- Personal Emacs composition root -*- lexical-binding: t; -*-
;;; Commentary:
;; Load personal configuration modules in dependency order.
;;; Code:

(add-to-list 'load-path (expand-file-name "lisp" user-emacs-directory))

(require 'mb-options)

;;; ---------------------------------------- INIT



(if (native-comp-available-p)
    (message "Native compilation enabled!")
  (warn "Native compilation not enabled!"))


(require 'package)
(require 'use-package)

(add-to-list 'package-archives
	     '("melpa" . "https://melpa.org/packages/") t)

(setq package-install-upgrade-built-in t
      use-package-always-ensure t
      use-package-verbose t)

(defun mb-package-preload-tramp-archive (&rest _args)
  "Load TRAMP archive support before validating package archive paths."
  ;; Lazy initialization misresolves TRAMP's test/resources/foo.iso/ entry
  ;; relative to the temporary directory, making the first update fail.
  (require 'tramp-archive))

(advice-add 'package-untar-buffer :before #'mb-package-preload-tramp-archive)

;; no-littering: organize emacs temporary files
(use-package no-littering
  :custom
  (treesit-extra-load-path
   (list (no-littering-expand-var-file-name "tree-sitter/"))))


;; NOTE: the background-color was added in early-init.el but should be removed
;; to avoid discrepancies in background color in new frames
(setq default-frame-alist (assq-delete-all 'background-color default-frame-alist))

(require 'mb-core)
(require 'mb-editing)
(require 'mb-ui)
(require 'mb-navigation)
(require 'mb-completion)
(require 'mb-vc)
(require 'mb-development)
(require 'mb-bindings)

(defun mb-enable-image-toggle-for-svg ()
  "Enable switching SVG buffers between source and rendered image views."
  (when (string-match-p "\\.svg\\'" (or buffer-file-name ""))
    (image-minor-mode 1)))

(add-hook 'nxml-mode-hook #'mb-enable-image-toggle-for-svg)

(message "EDITOR MODE: %s" mb-editor)
(pcase mb-editor
  ('evil (require 'mb-modal-evil))
  ('none nil)
  (_ (user-error "Unsupported mb-editor value: %S" mb-editor)))

(provide 'init)
;;; init.el ends here
