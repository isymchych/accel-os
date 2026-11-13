import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactElement } from "react";

import type { Account } from "../../contracts/index.ts";
import { useAppModel } from "../app/app-provider.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { requestFeedback } from "../transport/errors.ts";

const inactiveAccounts = Atom.make(AsyncResult.initial<readonly Account[]>());

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
  return selected === null ? null : <AccountSelection selected={selected} connected={connected} />;
}

function AccountSelection({
  selected,
  connected,
}: {
  selected: string;
  connected: boolean;
}): ReactElement {
  const { requests } = useAppModel();
  const accountQuery = connected ? requests.accounts : inactiveAccounts;
  const result = useAtomValue(accountQuery);
  const [mutation, selectAccount] = useAtom(requests.selectAccount);
  const accounts = AsyncResult.getOrElse(result, () => []);
  const error = requestFeedback(mutation, true) ?? requestFeedback(result);
  const selectedAccount = accounts.find((account) => account.profile === selected);
  return (
    <div className="space-y-2 px-4 py-3">
      <span id="account-label" className="text-xs font-medium text-muted-foreground">
        Account for new sessions
      </span>
      <Select
        value={selected}
        disabled={!connected || mutation.waiting || accounts.length === 0}
        onValueChange={(profile) => {
          if (!profile || profile === selected) return;
          selectAccount({ payload: { profile } });
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
