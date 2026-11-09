;;; format-emacs.el --- Format repository Emacs Lisp -*- lexical-binding: t; -*-
;;; Commentary:
;; Apply canonical Emacs Lisp indentation, or verify it without modifying files.
;;; Code:

(require 'emacs-project)

(defun mb/format-emacs-buffer ()
  "Apply canonical formatting to the current Emacs Lisp buffer."
  (emacs-lisp-mode)
  (indent-region (point-min) (point-max))
  (delete-trailing-whitespace)
  (unless (or (= (point-min) (point-max))
              (= (char-before (point-max)) ?\n))
    (goto-char (point-max))
    (insert "\n")))

(defun mb/format-emacs-file (file check)
  "Format FILE, returning non-nil when it differed and CHECK is non-nil."
  (with-temp-buffer
    (insert-file-contents file)
    (let ((original (buffer-string)))
      (setq buffer-file-name file)
      (let ((inhibit-message t))
        (mb/format-emacs-buffer))
      (unless (string= original (buffer-string))
        (if check
            t
          (write-region (point-min) (point-max) file nil 'silent)
          nil)))))

(defun mb/format-emacs-main ()
  "Format or check all repository Emacs Lisp files."
  (let ((check (equal (getenv "EMACS_FORMAT_MODE") "check"))
        (changed nil))
    (dolist (file (mb/emacs-project-files))
      (when (mb/format-emacs-file file check)
        (push (file-relative-name file mb/emacs-project-root) changed)))
    (if changed
        (progn
          (dolist (file (nreverse changed))
            (message "Needs formatting: %s" file))
          (kill-emacs 1))
      (message "Emacs Lisp formatting %s (%d files)"
               (if check "passed" "complete")
               (length (mb/emacs-project-files))))))

(mb/format-emacs-main)

;;; format-emacs.el ends here
