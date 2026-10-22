;;; mb-flycheck-oxlint-startup-test.el --- Saved-file Oxlint checks -*- lexical-binding: t; -*-
;;; Code:

(require 'ert)
(require 'flycheck)

(ert-deftest mb/flycheck-oxlint-checks-saved-files-without-temporaries ()
  (let* ((root (make-temp-file "mb-oxlint-test-" t))
         (filename (expand-file-name "main.ts" root))
         (predicate (flycheck-checker-get 'javascript-oxlint 'predicate)))
    (unwind-protect
        (with-temp-buffer
          (write-region "export const value = 1;\n" nil filename nil 'silent)
          (insert-file-contents filename t)
          (set-buffer-modified-p nil)
          (should predicate)
          (should (funcall predicate))
          (let ((arguments (flycheck-checker-substituted-arguments 'javascript-oxlint)))
            (should (member filename arguments))
            (should-not flycheck-temporaries)
            (should (equal (directory-files root nil directory-files-no-dot-files-regexp)
                           '("main.ts"))))
          (goto-char (point-max))
          (insert "export const unsaved = true;\n")
          (should-not (funcall predicate))
          (should (equal (with-temp-buffer
                           (insert-file-contents filename)
                           (buffer-string))
                         "export const value = 1;\n"))
          (setq buffer-file-name nil)
          (set-buffer-modified-p nil)
          (should-not (funcall predicate)))
      (delete-directory root t))))

(provide 'mb-flycheck-oxlint-startup-test)
;;; mb-flycheck-oxlint-startup-test.el ends here
