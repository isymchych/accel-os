;;; mb-lsp-eslint-startup-test.el --- ESLint startup regression test -*- lexical-binding: t; -*-
;;; Code:

(require 'ert)

(ert-deftest mb/lsp-eslint-deferred-startup ()
  (should-not (featurep 'lsp-mode))
  (require 'lsp-mode)
  (require 'lsp-eslint)
  (let* ((root (make-temp-file "mb-lsp-eslint-test-" t))
         (source (expand-file-name "src/" root))
         (filename (expand-file-name "main.ts" source))
         (default-directory (file-name-as-directory root))
         (project-find-functions (list (lambda (_) (cons 'transient root))))
         (activation (lsp--client-activation-fn (gethash 'eslint lsp-clients))))
    (unwind-protect
        (progn
          (make-directory source t)
          (should-not (funcall activation filename 'fundamental-mode))
          (write-region "export default [];" nil
                        (expand-file-name "eslint.config.mjs" root) nil 'silent)
          (should (funcall activation filename 'fundamental-mode))
          (should-not
           (funcall activation (expand-file-name "data.json" source) 'fundamental-mode))
          (let ((lsp-eslint-enable nil))
            (should-not (funcall activation filename 'fundamental-mode))))
      (delete-directory root t))))

(provide 'mb-lsp-eslint-startup-test)
;;; mb-lsp-eslint-startup-test.el ends here
