;;; emacs-project.el --- Repository Emacs Lisp paths -*- lexical-binding: t; -*-
;;; Commentary:
;; Own repository path resolution and Emacs Lisp source discovery.
;;; Code:

(defconst mb/emacs-project-root
  (or (getenv "ACCEL_OS")
      (error "ACCEL_OS is not set"))
  "Repository root containing the Emacs configuration.")

(defconst mb/emacs-project-config-dir
  (expand-file-name "dotfiles/dot_config/emacs" mb/emacs-project-root)
  "Repository Emacs configuration directory.")

(defun mb/emacs-project-files ()
  "Return repository Emacs Lisp files in deterministic order."
  (sort
   (append
    (list
     (expand-file-name "early-init.el" mb/emacs-project-config-dir)
     (expand-file-name "init.el" mb/emacs-project-config-dir))
    (directory-files
     (expand-file-name "lisp" mb/emacs-project-config-dir) t "\\.el\\'")
    (directory-files
     (expand-file-name "tests" mb/emacs-project-config-dir) t "\\.el\\'")
    (directory-files
     (expand-file-name "dotfiles/scripts/emacs" mb/emacs-project-root) t "\\.el\\'"))
   #'string<))

(provide 'emacs-project)
;;; emacs-project.el ends here
