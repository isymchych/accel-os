import { useEffect, useState, type ReactElement } from "react";

import type { Account } from "../contracts/index.ts";
import { useApi } from "./api.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";

function label(account: Account): string {
  return [account.email ?? account.accountId ?? account.profile, account.plan]
    .filter(Boolean)
    .join(" · ");
}

/** The shared selection applies only to execution owners created afterward. */
export function AccountSelector({
  selected,
  connected,
}: {
  selected: string | null;
  connected: boolean;
}): ReactElement | null {
  const workspace = useApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!connected || selected === null) return undefined;
    let cancelled = false;
    void workspace.accounts().then(
      (items) => {
        if (!cancelled) {
          setAccounts(items);
          setError(null);
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Cannot load accounts");
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [workspace, connected, selected]);
  if (selected === null) return null;
  const selectedAccount = accounts.find((account) => account.profile === selected);
  return (
    <div className="space-y-2 px-4 py-3">
      <span id="account-label" className="text-xs font-medium text-muted-foreground">
        Account for new sessions
      </span>
      <Select
        value={selected}
        disabled={!connected || pending || accounts.length === 0}
        onValueChange={(profile) => {
          if (!profile || profile === selected) return;
          setPending(true);
          setError(null);
          void workspace
            .selectAccount(profile)
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Cannot select account");
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        <SelectTrigger aria-labelledby="account-label" className="w-full min-w-0">
          <SelectValue>{selectedAccount ? label(selectedAccount) : selected}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.profile} value={account.profile}>
              {label(account)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Existing sessions keep their original account.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
