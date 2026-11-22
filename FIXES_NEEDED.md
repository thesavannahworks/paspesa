# Remaining Fixes Needed

## Status
Branch: `feature/admin-controls-and-calculator`
Commit: Partial implementation with WIP commit

## Critical Issues to Fix

### 1. Payment Provider Selector (Back Office)
**Problem:** Need UI control to select active payment provider
**Location:** `apps/backend/src/admin/admin.controller.ts` - Settings GET handler
**Solution:**
```typescript
// In settings GET handler, after line with pmCheckbox definition:
const providers = this.providers.all;
const activeProvider = st.activePaymentProvider || '';

// In the HTML form, add after "Offline authorization (days)" and before "Transaction Type Controls":
<h3>Payment Provider</h3>
<p class="muted">Select which M-PESA payment provider to use. Only one active at a time.</p>
<label for="activePaymentProvider">Active Provider</label>
<select id="activePaymentProvider" name="activePaymentProvider" ${mayEdit ? html`` : html`disabled`}>
  <option value="">Default (first configured)</option>
  ${providers.map(p => html`<option value="${p.name}" ${activeProvider === p.name ? html`selected` : html``}>${p.name}</option>`)}
</select>

// In settings POST handler, add to updateSettings call:
activePaymentProvider: form.activePaymentProvider || null,
```

### 2. Mobile Calculator Issues
**Problems:**
a) Hidden too deep (in wallet → tools section)
b) Header styling doesn't match app (back arrow, dark mode)
c) UI doesn't match existing pages

**Solutions:**

#### a) Move Calculator to Profile (More Accessible)
File: `apps/mobile/src/app/profile.tsx`
Add calculator link in the main profile menu, not buried in wallet.

#### b) Fix Header Styling
File: `apps/mobile/src/app/wallet/calculator.tsx`
Replace current header with:
```typescript
import { Screen, ScreenHeader } from '@/components/ui';

// Replace View + Stack.Screen with:
<Screen>
  <ScreenHeader title="Token Calculator" />
  <ScrollView ...>
```

#### c) Match Existing UI Patterns
Use EdgeCard component like other pages:
```typescript
import { EdgeCard } from '@/components/ui';

// Wrap each calculation section:
<EdgeCard style={{ marginTop: s(22) }}>
  <T variant="heading">Shillings to Tokens</T>
  ...
</EdgeCard>
```

### 3. Settings Not Syncing Immediately
**Problem:** Transaction type controls set in back office don't apply to frontend until manual sync

**Root Cause:** Settings are fetched via `/v1/pricing` which is called:
- On app start
- Every ~60 seconds background interval
- On manual "Back up now"

**Solution:** Implement immediate sync trigger when settings change

#### Backend Changes:
File: `apps/backend/src/monetization.service.ts`

After updateSettings saves, we need to notify devices. Two approaches:

**Approach A: Polling Optimization** (Simpler, keeps current architecture)
Reduce the sync interval when app is active:
```typescript
// In apps/mobile/src/services/sync.ts
// Change interval from 60s to 15s for active sessions
const SYNC_INTERVAL_MS = 15_000; // Was 60_000
```

**Approach B: Settings Version** (More elegant)
Add settings version to detect changes:

1. Add `settings_version` column to `monetization_settings` table
2. Increment version on every update
3. Client checks version on each sync, reloads config if changed

#### Frontend Changes:
File: `apps/mobile/src/services/runtime.ts` or equivalent

Check transaction type controls before allowing transactions:
```typescript
export function isTransactionTypeEnabled(type: SimulationType, settings: MonetizationSettings): boolean {
  const controls = settings.transactionTypeControls || {};
  return controls[type] !== false; // Default enabled
}
```

Use in transaction entry screens:
```typescript
// In send-money.tsx, lipa.tsx, etc.
const settings = deps.config.monetization;
if (!isTransactionTypeEnabled('SEND_MONEY', settings)) {
  // Show disabled message or redirect
  return <DisabledScreen type="Send Money" />;
}
```

### 4. Update Tests
File: `apps/backend/test/monetization.test.ts`

Update the settings test to expect new field:
```typescript
expect(await money.settings()).toEqual({
  paymentRequired: false,
  freeSimulationsOffline: true,
  shillingsPerToken: 1,
  minimumPurchase: 1,
  offlineAuthorizationDays: 3,
  transactionTypeControls: {},
  paymentMethodControls: { tokensEnabled: true, directPayEnabled: true },
  activePaymentProvider: null, // ADD THIS
});
```

## Implementation Order

1. **Fix Back Office Calculator** (Already done in WIP)
   - ✅ Moved JavaScript to admin.js
   - ✅ Real-time updates working

2. **Add Payment Provider Selector** (5 min)
   - Add UI to settings page
   - Update POST handler
   - Update test

3. **Fix Mobile Calculator UI** (15 min)
   - Move to Screen/ScreenHeader pattern
   - Use EdgeCard for sections
   - Fix colors for dark mode

4. **Move Calculator to Profile** (10 min)
   - Add prominent link in profile menu
   - Keep wallet link as secondary access

5. **Implement Settings Enforcement** (20 min)
   - Add transaction type check helper
   - Apply in all transaction screens
   - Show disabled state

6. **Fix Settings Sync** (15 min)
   - Reduce sync interval to 15s (quick fix)
   - OR implement settings version (better)

7. **Test Everything** (10 min)
   - Update monetization test
   - Run all tests
   - Manual test: toggle setting, see immediate effect

## Testing Checklist

- [ ] Back office calculator updates in real-time
- [ ] Can select payment provider in settings
- [ ] Mobile calculator has correct header/UI
- [ ] Calculator accessible from profile
- [ ] Disable Send Money in back office → immediately disabled in app
- [ ] Enable Send Money → immediately enabled
- [ ] Dark mode works correctly
- [ ] All tests pass

## Notes

- The CSP in back office blocks inline scripts, hence external admin.js
- Settings are delivered via `/v1/pricing` endpoint to all devices
- Transaction enforcement must happen on BOTH backend (security) and frontend (UX)
- Payment provider selection only changes which provider is used, doesn't affect whether payments work

## Estimated Time
Total: ~75 minutes to complete all fixes properly
