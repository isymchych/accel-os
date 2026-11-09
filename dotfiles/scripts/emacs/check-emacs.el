;;; check-emacs.el --- Validate repository Emacs Lisp -*- lexical-binding: t; -*-
;;; Commentary:
;; Run syntax and documentation checks without loading the user configuration.
;;; Code:

(require 'checkdoc)
(require 'emacs-project)

(defun mb/check-emacs-relative-name (file)
  "Return FILE relative to the repository root."
  (file-relative-name file mb/emacs-project-root))

(defun mb/check-emacs-syntax (file)
  "Return syntax errors found in FILE."
  (with-temp-buffer
    (insert-file-contents file)
    (setq buffer-file-name file)
    (emacs-lisp-mode)
    (condition-case err
        (progn
          (check-parens)
          (goto-char (point-min))
          (while (progn
                   (forward-comment (point-max))
                   (not (eobp)))
            (read (current-buffer)))
          nil)
      (error
       (list
        (format "%s:%d: %s"
                (mb/check-emacs-relative-name file)
                (line-number-at-pos)
                (error-message-string err)))))))

(defun mb/check-emacs-docs (file)
  "Return Checkdoc errors found in FILE."
  (with-temp-buffer
    (insert-file-contents file)
    (setq buffer-file-name file)
    (emacs-lisp-mode)
    (let ((errors nil)
          (checkdoc-autofix-flag 'never)
          (checkdoc-generate-compile-warnings-flag nil)
          (checkdoc-package-keywords-flag nil)
          (checkdoc-spellcheck-documentation-flag nil))
      (let ((checkdoc-create-error-function
             (lambda (text start _end &optional _unfixable)
               (push
                (format "%s:%d: %s"
                        (mb/check-emacs-relative-name file)
                        (line-number-at-pos start)
                        text)
                errors))))
        (let ((inhibit-message t))
          (checkdoc-current-buffer t)))
      (nreverse errors))))

(defun mb/check-emacs-main ()
  "Validate all repository Emacs Lisp files."
  (let ((errors nil))
    (dolist (file (mb/emacs-project-files))
      (let ((syntax-errors (mb/check-emacs-syntax file)))
        (setq errors
              (nconc errors
                     syntax-errors
                     (unless syntax-errors
                       (mb/check-emacs-docs file))))))
    (if errors
        (progn
          (dolist (validation-error errors)
            (message "%s" validation-error))
          (kill-emacs 1))
      (message "Emacs Lisp validation passed (%d files)"
               (length (mb/emacs-project-files))))))

(mb/check-emacs-main)

;;; check-emacs.el ends here
