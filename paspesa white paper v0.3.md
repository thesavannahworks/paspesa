# PASPESA
## Product, Business, Functional and Technical White Paper

**Version:** 0.3 — Development Handoff Edition  
**Date:** 14 November 2026  
**Document status:** Baseline specification for initial development  
**Product:** Paspesa  
**Document purpose:** Define the product, business rules, user journeys, system architecture, data requirements, operational rules, and development expectations for the Paspesa application.

---

# Document control

## 1. Purpose of this document

This document is the central specification for Paspesa. It brings together the decisions made during product planning and adds the implementation detail required to begin development.

It is intended for:

- The product owner.
- IDE coding agents and software developers.
- UI/UX designers.
- Backend and database developers.
- Testers and quality assurance contributors.
- Anyone responsible for maintaining or extending Paspesa.

The document should be read in full before development begins. It is not merely a feature list. It defines how the different parts of the system relate to one another and what must remain consistent throughout the application.

The White Paper is the primary product reference. Where an implementation detail is not explicitly settled, the agent must distinguish a reasonable technical implementation from a change to an agreed product decision.

## 2. Decision-status terminology

The following terms must be used consistently.

| Status | Meaning |
|---|---|
| **AGREED** | Explicitly accepted product or business decision. Implement as specified. |
| **SPECIFIED** | Detailed technical or functional requirement established in this document to make development practical. |
| **PROPOSED** | Recommended direction that has not yet received final product-owner approval. |
| **OPEN** | Requires a product decision or missing reference before that particular feature can be finalized. |
| **DEFERRED** | Intentionally postponed to a later development phase. |
| **REFERENCE** | External or visual reference used to guide the simulator, not a requirement to copy another company's identity or implementation. |

A coding agent must not convert a PROPOSED, OPEN or DEFERRED item into an AGREED requirement without approval.

## 3. Scope of this handoff

This specification covers:

1. Product identity and boundaries.
2. Application clients and shared architecture.
3. Initial development scope.
4. Account and opening-balance management.
5. Transaction processing and transaction catalogue.
6. Transaction charges and fee schedules.
7. Transaction messages, confirmations and receipts.
8. Transaction history and statements.
9. Offline-first operation and synchronization.
10. Data consistency and duplicate protection.
11. Monetization and pricing architecture.
12. Token wallet, ledger and device allocation.
13. Direct pay-per-simulation payments.
14. Administrative backoffice.
15. Security, privacy and data integrity.
16. Database and API design requirements.
17. UI/UX and reference-screen handling.
18. Testing, acceptance criteria and delivery expectations.
19. Development phases and future capabilities.

The product owner may provide additional screens, message examples and detailed transaction journeys during implementation. Their absence does not authorize the agent to invent exact visual templates or message wording.

---

# PART I — PRODUCT FOUNDATION

## 4. Product definition

Paspesa is a mobile-money transaction simulator with persistent account data, a transaction-processing engine, a generated message system, transaction history, statements and an extensible monetization system.

Users can create simulated mobile-money activity, maintain a simulated account balance, generate associated transaction records and confirmation messages, and review their simulated financial activity.

Paspesa is not a real mobile-money service. It does not move actual customer funds through Safaricom or M-PESA payment rails when a user performs a simulated transaction.

The product may use familiar mobile-money interaction patterns as UX references, but Paspesa must have its own identity, application name, branding, icons, assets, layouts and message presentation.

## 5. Core product principles

### 5.1 Simulation, not real payment processing

Every simulated operation must remain clearly identifiable as simulated.

The application must not:

- Claim that a simulated transaction was processed by Safaricom.
- Connect a simulated Send Money or Buy Goods action to a real M-PESA recipient.
- Present a generated message as an authentic Safaricom-issued confirmation.
- Suggest that a simulated balance is spendable real money.
- Create misleading real-payment verification claims.

Paspesa may offer genuine payment processing for its own commercial services, such as purchasing simulation tokens or paying for a simulation. These commercial payments are separate from the simulated mobile-money transactions.

The distinction must be maintained in the UI, records, messages, exports and documentation.

### 5.2 One consistent financial state

The application must not be a collection of screens that independently generate messages.

A transaction must affect the underlying simulated account state. The same transaction must feed:

- The account balance.
- The transaction ledger.
- Transaction history.
- Generated messages.
- Transaction detail views.
- Statements and financial summaries.

A successful transaction must not appear in one area while being absent or inconsistent in another.

### 5.3 Offline-first from the beginning

The local application must be capable of ordinary simulator operation without a live internet connection.

The backend is responsible for shared persistence, synchronization, account ownership and online-controlled operations. It must not be a requirement for every ordinary local simulator interaction.

### 5.4 Shared business logic

Transaction rules, fee calculations, balance impacts, pricing rules and message-generation logic should be reusable rather than independently implemented in each client.

### 5.5 Extensibility

The application must be designed so that new transaction types, additional clients, new message templates, pricing rules and administrative features can be introduced without rewriting the core system.

---

# PART II — APPLICATIONS AND ARCHITECTURE

## 6. Supported application clients

The long-term Paspesa platform is intended to support:

1. Android mobile application.
2. iOS mobile application.
3. Progressive Web Application (PWA).
4. Desktop web application.

The PWA and desktop browser application may share the same web codebase. The PWA adds installability and browser-supported offline capabilities; it does not require a separate business-logic implementation.

### 6.1 Shared platform

All clients must use the same underlying:

- Transaction definitions.
- Validation rules.
- Fee schedules.
- Balance calculations.
- Transaction identifiers and idempotency rules.
- Message-generation rules.
- Pricing calculations.
- Account and wallet concepts.
- API contracts and data structures.

The interfaces may differ to suit their devices. For example, a mobile application may use bottom navigation, while the desktop interface may use a sidebar.

The difference in presentation must not create differences in transaction behaviour.

### 6.2 Initial client priority

**SPECIFIED:** The initial development must establish a working application foundation and a reusable architecture. The agent should inspect the supplied repository and determine the best implementation sequence based on the actual codebase.

The agent must not assume that all four clients need to be delivered simultaneously.

The architecture must nevertheless avoid decisions that prevent the other clients from being added later.

## 7. Proposed technical architecture

The following is the preferred technical direction from planning. It is a candidate architecture, not an instruction to force these technologies onto an existing repository without inspection.

| Layer | Preferred direction |
|---|---|
| Mobile | React Native with Expo |
| Web/PWA | React with TypeScript |
| Backend | Node.js with NestJS |
| Main server database | PostgreSQL |
| Mobile local database | SQLite |
| Web local database | IndexedDB |
| API | REST |
| Shared business logic | Reusable TypeScript packages |
| Web presentation | Responsive component-based UI |
| API communication | Typed API client |
| Validation | Shared schemas and server-side validation |

The agent must assess the existing repository and explain any proposed deviation before undertaking major restructuring.

### 7.1 Proposed monorepo layout

A possible structure is:

```text
paspesa/
├── apps/
│   ├── mobile/
│   ├── web/
│   └── backend/
│
├── packages/
│   ├── core/
│   ├── types/
│   ├── api-client/
│   ├── validation/
│   ├── transaction-engine/
│   ├── pricing/
│   ├── messaging/
│   └── ui/
│
├── docs/
│   ├── architecture/
│   ├── design/
│   ├── specifications/
│   └── decisions/
│
└── README.md
```

This is an architectural guide. The final repository structure should reflect the actual project and avoid unnecessary packages or abstractions.

### 7.2 Responsibility boundaries

The implementation should separate:

**Presentation layer**
- Screens, forms, navigation, dialogs, cards and visual states.
- User input and display formatting.
- Loading, error, empty and offline indicators.

**Application layer**
- Use cases and workflows.
- Initiating a transaction.
- Recharging an account.
- Selecting a payment method.
- Requesting synchronization.
- Viewing statements.

**Domain/core layer**
- Transaction rules.
- Fee calculations.
- Balance impacts.
- Transaction state transitions.
- Idempotency.
- Pricing calculations.
- Token accounting rules.
- Message-generation rules.

**Persistence layer**
- Local database.
- Server database.
- Transactional writes.
- Data migrations.
- Outbox and synchronization records.

**Backend/API layer**
- Account and device ownership.
- Server-side validation.
- Authoritative online pricing.
- Payment verification.
- Token wallet accounting.
- Synchronization and reconciliation.
- Administrative operations.

Business rules must not be embedded only in screen components.

---

# PART III — INITIAL FUNCTIONAL SCOPE

## 8. Initial development objective

The initial development should establish a usable Paspesa simulator with a reliable underlying account and transaction system.

The initial focus is the simulator foundation, not the entire future commercial platform.

The first development stages should prioritize:

1. Project inspection and architecture.
2. Application shell and navigation.
3. Account information and opening balance.
4. Account recharge through General Operations.
5. Central transaction engine.
6. Initial transaction journeys.
7. Fee calculation and balance updates.
8. Transaction records and generated messages.
9. Transaction history.
10. Local persistence.
11. Backend persistence and synchronization foundation.
12. Statements and account summaries.
13. Testing and consistency verification.

Token purchasing, direct commercial payment processing, advanced administration and multi-device token reservations must be architecturally supported but can be implemented in their later phases.

The agent should not prematurely implement an incomplete payment or token system merely to make the initial UI appear finished.

## 9. Main application areas

The application should be organized around the following functional areas.

### 9.1 Home/dashboard

The dashboard should provide a clear overview of the simulated account.

Expected information and actions include:

- Greeting or account identity.
- Simulated M-PESA balance.
- Balance visibility control.
- Available account-related actions.
- Quick transaction shortcuts.
- Frequent or favourite recipients and merchants, where implemented.
- Recent transaction activity.
- Access to statements.
- Access to messages.
- Navigation to account and general operations.

The supplied home-screen screenshot is a visual reference for the hierarchy and general layout. It is not an instruction to reproduce Safaricom's branding or assets.

### 9.2 Transaction entry and confirmation

The transaction screens should collect the information required for each transaction type, validate it, show a review/confirmation stage and then process the simulation.

The exact screen fields and message templates should be taken from the relevant references supplied by the product owner.

### 9.3 Account and General Operations

This area is important because it controls the simulated account's initial balance and incoming account activity.

It must provide an account recharge operation described in Section 10.

### 9.4 Transaction history and messages

The application must maintain structured transaction records and corresponding messages. These should be linked, not treated as unrelated content.

### 9.5 Statements

Users should be able to view and search their simulated account activity through a statement interface. The supplied statement screenshot is a reference for the general page structure.

---

# PART IV — ACCOUNT AND BALANCE MANAGEMENT

## 10. Opening balance and account recharge

### 10.1 Opening balance

A simulated account requires an initial M-PESA balance.

The account must support an opening balance that establishes its starting financial position.

The opening balance is not a real deposit and must be identified as simulated account data.

### 10.2 Recharge from Accounts / General Operations

**AGREED:** The opening/simulated M-PESA balance must be rechargeable from the Accounts or General Operations area.

The user must be able to:

1. Open Accounts / General Operations.
2. Select the account recharge or balance top-up operation.
3. Enter any preferred recharge amount, subject to the simulator's validation rules.
4. Select or enter the sender details.
5. Confirm the recharge.
6. Have the amount added to the previous balance.
7. Have the recharge recorded as an incoming transaction.

The sender defaults to:

- **Sender name:** Paspesa
- **Sender phone number:** A suitable Paspesa default value configured by the application.

The user may instead specify:

- A custom sender name.
- A custom sender phone number.

The recharge should be represented as an incoming transaction from the selected sender.

### 10.3 Balance calculation

The rule is:

\[
\text{New balance}=\text{Previous balance}+\text{Recharge amount}
\]

For example:

| Item | Amount |
|---|---:|
| Previous balance | KSh 1,000 |
| Recharge amount | KSh 500 |
| New balance | KSh 1,500 |

The recharge must not replace the previous balance.

### 10.4 Recharge record

A recharge must create a proper incoming transaction record containing at least:

- Unique transaction ID.
- Transaction type: account recharge / simulated deposit.
- Amount received.
- Sender name.
- Sender phone number, where supplied.
- Previous balance.
- New balance.
- Transaction timestamp.
- Transaction status.
- Source: General Operations / Account Recharge.
- Synchronization state.

The corresponding incoming confirmation message must be generated and saved.

### 10.5 Recharge accounting

A recharge is a positive balance movement. It must be included in the transaction ledger and statement.

It must not be implemented as a direct overwrite of the balance field.

The system may store a cached current balance for fast access, but the balance must remain reconcilable against the opening balance and all recorded balance movements.

### 10.6 Repeated recharge and editing

Every recharge submission is a separate operation unless it is a retry of the same operation using the same idempotency identifier.

Editing or deleting a recharge must not silently rewrite financial history. If an incorrect recharge needs correction, use an explicit adjustment or reversal record with an audit trail.

---

# PART V — TRANSACTION ENGINE

## 11. Central transaction engine

The transaction engine is one of the most important components of Paspesa.

All supported transaction types should use a common processing framework. The engine should accept a transaction type and validated transaction data, apply the correct rules and produce a consistent result.

### 11.1 Responsibilities

The engine is responsible for:

1. Receiving a transaction request.
2. Identifying the transaction type.
3. Validating required fields.
4. Validating account and transaction constraints.
5. Resolving the applicable fee schedule.
6. Calculating the fee.
7. Calculating the balance impact.
8. Checking available simulated balance where applicable.
9. Resolving the selected Paspesa service-payment method when monetization is enabled.
10. Applying the transaction exactly once.
11. Generating a unique transaction identifier.
12. Creating the transaction record.
13. Updating the account balance.
14. Generating the associated simulated message.
15. Persisting the result.
16. Updating transaction history and statement data.
17. Queuing the operation for synchronization when necessary.

### 11.2 Conceptual processing flow

```text
User selects transaction type
          |
          v
Enter transaction details
          |
          v
Validate required information
          |
          v
Resolve transaction rules
          |
          v
Calculate transaction fee
          |
          v
Calculate balance impact
          |
          v
Check simulated account balance
          |
          v
Select Paspesa service payment method
          |
          v
Authorize the selected method
          |
          v
Process simulation atomically
          |
          v
Save transaction + balance movement
          |
          v
Generate and save message
          |
          v
Update history and statements
          |
          v
Mark local/server synchronization state
```

The flow must be implemented with transaction integrity. A partially completed operation must not be presented as successful.

### 11.3 Atomic processing

The creation of a successful transaction, its balance movement and its corresponding message should be treated as one logical operation.

Where a database supports transactions, related writes should use a database transaction or equivalent atomic mechanism.

The application must avoid states such as:

- Balance updated but transaction record missing.
- Transaction record saved but balance not updated.
- Successful transaction displayed but message not saved.
- Message generated for a transaction that ultimately failed.
- A retry producing a second balance movement.

If a failure occurs, the application must preserve a clear failure state and follow the reversal rules in Section 24.

### 11.4 Transaction status

The system should distinguish the business outcome from the synchronization state.

Suggested business statuses:

| Status | Meaning |
|---|---|
| Draft | User is entering transaction details. |
| Awaiting confirmation | Transaction details are ready for review. |
| Processing | The simulator is processing the operation. |
| Successful | All required simulation records and balance effects are committed. |
| Failed | The operation did not complete. |
| Reversed | A previously applied operation has been corrected by a separate reversal. |

Suggested synchronization states:

| State | Meaning |
|---|---|
| Local only | Saved on this device, not yet uploaded. |
| Pending | Waiting for synchronization. |
| Syncing | Upload or reconciliation is in progress. |
| Synced | Backend has accepted and stored the record. |
| Needs review | Automatic reconciliation could not safely resolve the record. |

A successful offline simulation may be locally successful while still pending backend synchronization. The interface must not confuse these two concepts.

## 12. Transaction catalogue

The initial transaction catalogue includes the following candidate types. The agent should implement the transaction journeys in the order agreed with the product owner and use the supplied references for exact fields and presentation.

### 12.1 Send Money

Purpose: simulate sending money from the account to another recipient.

Expected information:

- Recipient name.
- Recipient phone number.
- Amount.
- Applicable transaction fee.
- Simulated account balance before the transaction.
- Simulated account balance after the transaction.

Expected effects:

- Decrease the simulated balance by the transaction amount and applicable fee.
- Create a debit transaction record.
- Generate the corresponding outgoing confirmation message.
- Make the transaction available in history and statements.

### 12.2 Pochi la Biashara

Purpose: simulate a payment to a Pochi merchant.

Expected information includes the merchant or recipient identity, phone number or relevant reference, and amount.

The transaction should use the shared Lipa na M-PESA journey where appropriate, while preserving its transaction type and message details.

The Paspesa fee rule is defined in Section 14.

### 12.3 Buy Goods / Till

Purpose: simulate payment to a merchant using a Till number.

Expected information:

- Till number.
- Merchant name.
- Amount.
- Applicable fee.
- Account balance.

Where the user enters a Till number, the interface may display a merchant name if the relevant merchant data is available. Do not claim to verify a real merchant unless an actual supported lookup exists.

The supplied reference shows a Lipa na M-PESA page with Buy Goods selected, a Till Number field, merchant name, amount, payment method selection, a confirmation page and a successful transaction page.

The user has indicated that the Pochi and Paybill journeys can share this general Lipa na M-PESA category and layout because their core interaction is similar. Their fields and labels must still be transaction-specific.

### 12.4 Paybill

Purpose: simulate payment to a business or biller.

Expected information:

- Business number.
- Account number or reference.
- Business name, where available.
- Amount.
- Applicable fee.
- Account balance.

The Paybill flow should use the same general Lipa na M-PESA category and confirmation pattern, with Paybill-specific fields.

### 12.5 Withdraw Money

Purpose: simulate withdrawing funds through an agent.

Expected information:

- Agent or outlet identifier, where required by the selected flow.
- Agent name, where available.
- Amount.
- Withdrawal fee.
- Account balance.

Expected effect:

\[
\text{New balance}=\text{Previous balance}-\text{Withdrawal amount}-\text{Withdrawal fee}
\]

The agent must use the withdrawal fee schedule in Section 15.

### 12.6 Airtime

Purpose: simulate purchasing airtime.

Expected information may include:

- Phone number.
- Amount.
- Account balance.

The exact transaction fee and message template must follow the configured rules and supplied reference. Do not assume an extra customer fee where no such rule has been established.

### 12.7 Deposit / incoming money

Purpose: represent incoming simulated funds.

The General Operations recharge flow is the defined initial form of this functionality. Other incoming transaction types may be added through the same engine.

### 12.8 Extensibility

Each transaction type should be defined through a consistent configuration or domain structure, including:

- Type identifier.
- Display name.
- Required fields.
- Validation rules.
- Fee schedule.
- Balance impact rule.
- Message template.
- Statement classification.
- Confirmation details.
- Supported payment methods.
- Offline eligibility.
- Any type-specific constraints.

Adding a new transaction type should not require duplicating the transaction engine.

---

# PART VI — TRANSACTION FEES AND TARIFF CONFIGURATION

## 13. Tariff principles

Paspesa will use reference M-PESA consumer fee schedules as the basis for its simulated transaction charges.

The schedules are configurable application data. They must not be hardcoded separately in multiple screens.

The agent must centralize fee resolution and calculation so that every transaction journey uses the same correct values.

The fee schedules below are the reference values selected for the Paspesa simulator at this document's date. They are not a claim that Paspesa is connected to Safaricom or that these fees will remain current indefinitely.

## 14. Send Money, Pochi and Paybill fee schedule

**AGREED Paspesa configuration:** Use the same Send Money fee schedule for:

- Send Money.
- Pochi la Biashara.
- Paybill.

This is a deliberate simplification in Paspesa. It is not a statement that the actual merchant tariff arrangements for Pochi and Paybill are identical to Send Money.

| Transaction amount (KSh) | Paspesa fee (KSh) |
|---:|---:|
| 1–100 | 0 |
| 101–500 | 7 |
| 501–1,000 | 13 |
| 1,001–1,500 | 23 |
| 1,501–2,500 | 33 |
| 2,501–3,500 | 53 |
| 3,501–5,000 | 57 |
| 5,001–7,500 | 78 |
| 7,501–10,000 | 90 |
| 10,001–15,000 | 100 |
| 15,001–20,000 | 105 |
| 20,001–250,000 | 108 |

Amounts outside the configured supported range must be handled through validation and configuration, not by silently applying an arbitrary fee.

The schedule must be stored in a structured format with inclusive lower and upper boundaries.

## 15. Agent withdrawal fee schedule

**AGREED Paspesa configuration:** Use the reference agent-withdrawal schedule for Withdraw Money.

| Withdrawal amount (KSh) | Paspesa fee (KSh) |
|---:|---:|
| 50–100 | 11 |
| 101–500 | 29 |
| 501–1,000 | 29 |
| 1,001–1,500 | 29 |
| 1,501–2,500 | 29 |
| 2,501–3,500 | 52 |
| 3,501–5,000 | 69 |
| 5,001–7,500 | 87 |
| 7,501–10,000 | 115 |
| 10,001–15,000 | 167 |
| 15,001–20,000 | 185 |
| 20,001–35,000 | 197 |
| 35,001–50,000 | 278 |
| 50,001–250,000 | 309 |

Amounts below the supported minimum or above the configured maximum must be validated. The application must not silently assign a fee to an unsupported amount.

## 16. Buy Goods fee

**AGREED:** The customer-facing Buy Goods / Till transaction fee in Paspesa is KSh 0.

The simulator must show zero transaction fee for this transaction type.

This is a customer-fee simulation rule. It does not mean that merchant-side charges or actual Safaricom merchant arrangements are being modelled.

## 17. Fee calculation and balance impact

The fee schedule must be resolved by transaction type and amount.

For a debit transaction:

\[
\text{Total debit}=\text{Transaction amount}+\text{Fee}
\]

\[
\text{New balance}=\text{Previous balance}-\text{Total debit}
\]

Example:

| Item | Amount |
|---|---:|
| Previous balance | KSh 10,000 |
| Send Money amount | KSh 2,000 |
| Fee | KSh 33 |
| Total debit | KSh 2,033 |
| New balance | KSh 7,967 |

The system must display the fee before final confirmation whenever the applicable fee can be determined at that stage.

The confirmation and success screens must show the same amount and fee values that are stored in the transaction record.

## 18. Fee schedule administration

Fee schedules should be represented as configurable data, not duplicated conditional statements in individual screens.

The system should support:

- Fee schedule identification.
- Transaction-type assignment.
- Amount range boundaries.
- Fee values.
- Effective date.
- Active/inactive state.
- Configuration version.
- Administrative audit history.

A later tariff change must affect new transactions only. Historical transactions must retain the fee that was applied when they were created.

The agent should seed the initial fee schedules from this document and make them accessible to the future admin configuration layer.

---

# PART VII — MESSAGES, CONFIRMATIONS AND STATEMENTS

## 19. Generated message system

Paspesa must generate a corresponding simulated message for each transaction type that requires one.

The message system must not be a separate, manually populated collection unrelated to transaction records.

Each message should be linked to its source transaction through a stable identifier.

### 19.1 Message data

A message record should contain:

- Unique message ID.
- Related transaction ID.
- Message category.
- Message body or structured template data.
- Creation timestamp.
- Display timestamp.
- Read/unread state, if supported.
- Message status.
- Synchronization state.

### 19.2 Message templates

Templates must be separate from transaction processing logic.

A template should be able to receive structured transaction data and produce the required message content.

The agent must request the relevant message examples from the product owner when the exact wording or layout is needed.

Do not invent a final M-PESA-style message template and present it as approved.

All generated messages must remain clearly identifiable as Paspesa simulations.

### 19.3 Message consistency

The values in a message must match the saved transaction:

- Transaction ID.
- Amount.
- Recipient or sender.
- Phone number, where applicable.
- Fee.
- Resulting balance.
- Date and time.

A message must not be generated from values that differ from the committed transaction record.

## 20. Confirmation and success screens

The transaction journey should have a review stage before processing and a result stage afterwards.

The supplied screenshots demonstrate a general pattern:

1. Transaction entry.
2. Confirmation summary.
3. Payment-method selection where applicable.
4. PIN-entry-style simulation stage, if required by the Paspesa UX.
5. Processing.
6. Success or failure result.
7. Transaction detail and available follow-up actions.

The PIN-entry-style screen must not request or store a real M-PESA PIN. It must use a Paspesa-specific simulation interaction or another approved safe confirmation mechanism. Never collect a user's actual mobile-money PIN.

The success screen should display the result of the actual committed simulation, not a success state shown before the transaction is saved.

The exact success layout, message and visual details should follow the product owner's supplied reference material.

## 21. Transaction history

The history page must display records from the transaction ledger.

It should support, as appropriate:

- Date grouping.
- Transaction name or counterparty.
- Transaction type.
- Amount.
- Debit or credit indication.
- Transaction time.
- Transaction reference.
- Transaction detail navigation.
- Search and filtering.

The interface should distinguish incoming and outgoing activity clearly.

Transaction records must not be manually duplicated in a separate history-only store.

## 22. Statements

Statements should be generated from the same underlying transaction records and balance movements.

The statement page should support:

- Transaction listing.
- Date grouping.
- Search.
- Date range selection where implemented.
- Transaction details.
- Incoming and outgoing values.
- Relevant balance information.
- Export capability where implemented.
- Clear simulated-data identification.

The supplied statement screenshot is a visual reference. It demonstrates a statement heading, statement options, search field, date grouping and transaction rows.

The exact export formats and statement-verification behaviour should be implemented only to the extent supported by the approved Paspesa design. Paspesa must not claim to verify a real Safaricom statement.

### 22.1 Statement integrity

A statement must be reproducible from the underlying transaction ledger.

If a transaction is reversed, the statement must show the original transaction and its separate reversal or correction entry. Historical activity must not disappear silently.

---

# PART VIII — OFFLINE-FIRST OPERATION AND SYNCHRONIZATION

## 23. Offline-first requirements

Offline-first is a core Paspesa architectural requirement, not a later enhancement.

When the application has no internet connection, users should still be able to access locally saved simulator data and perform ordinary eligible simulated operations.

Expected offline capabilities include:

- Open the application.
- View locally saved account information.
- View the current locally calculated balance.
- Recharge the simulated account locally.
- Perform eligible simulated transactions.
- Generate and save simulated messages.
- View transaction history.
- View locally available statement information.
- Review transaction details.

Online-only capabilities include:

- Server synchronization.
- Account registration and authentication when introduced.
- Central wallet operations.
- Device token allocation and release.
- Online payment authorization.
- Online token purchases.
- Other operations requiring server authority.

### 23.1 Local database first

The application should read and write to its local database for normal simulator activity.

The UI should not wait for a server response to display an ordinary local transaction result when the transaction is eligible to run offline.

### 23.2 Local persistence

The application must persist data beyond an application restart.

The local database should store the information required to reconstruct the user's local simulator state, including:

- Account data.
- Opening balance.
- Balance movements.
- Transactions.
- Messages.
- Local preferences.
- Pending synchronization records.
- Relevant configuration snapshots.
- Local installation/device identity.

Browser storage clearing or uninstalling an application may remove local-only data. This limitation must be considered in the future recovery and account-registration design.

## 24. Synchronization model

When connectivity becomes available, Paspesa should synchronize pending local records with the backend.

Conceptual flow:

```text
Local transaction created
          |
          v
Persisted in local database
          |
          v
Local balance and UI updated
          |
          v
Added to synchronization outbox
          |
          v
Connectivity becomes available
          |
          v
Client submits pending operations
          |
          v
Backend validates and deduplicates
          |
          v
Backend stores or reconciles records
          |
          v
Backend returns synchronization result
          |
          v
Client updates local sync status
```

### 24.1 Synchronization states

At minimum:

- Pending.
- Syncing.
- Synced.
- Needs review / conflict.

The UI may show these states where useful, but should not overwhelm the user with technical detail.

### 24.2 Synchronization must be retry-safe

Network requests may fail, time out or be repeated.

A retry must not create another transaction, another message or another token deduction.

The server must recognize previously processed operation identifiers.

### 24.3 Multi-device synchronization

The long-term platform must support multiple devices associated with one account.

For example:

- Device A creates a transaction while offline.
- Device A saves the transaction locally.
- Device A reconnects.
- The transaction synchronizes to the backend.
- Device B retrieves the updated account data.
- Both devices show consistent synchronized information.

Unsynchronized offline data on Device A cannot automatically appear on Device B.

### 24.4 Multiple devices making offline transactions

Two devices may independently create offline operations from different local states.

The system must not silently overwrite one device's activity with another device's activity.

The backend must use explicit reconciliation rules. The local transaction records must be preserved, and any conflict that cannot be safely resolved must be marked for review.

A server-side authoritative ledger and deterministic reconciliation are required before multi-device offline spending is enabled for monetized operations.

### 24.5 Authentication later

Authentication and user registration are intentionally not a first-phase dependency.

The initial application should support a local anonymous account or installation identity.

The architecture should later allow a local installation's data to be associated with a registered user account through a controlled migration process.

The migration must avoid duplicate transactions and must not overwrite existing account history.

---

# PART IX — TRANSACTION INTEGRITY AND DUPLICATE PROTECTION

## 25. Idempotency

**AGREED:** Every simulation must have a unique identifier that protects it against accidental duplicate processing.

This requirement applies online and offline.

If the same simulation is retried, the system must return or recover the result of the existing simulation rather than create another one.

### 25.1 What duplicate protection must prevent

A retry must not:

- Create a second transaction record.
- Deduct the simulated balance twice.
- Apply the transaction fee twice.
- Deduct tokens twice.
- Trigger direct payment twice.
- Generate a duplicate confirmation message.
- Create duplicate statement entries.
- Apply the same synchronization operation twice.

### 25.2 Identifier generation

The client should generate a stable operation identifier when the simulation is first initiated.

That identifier must be persisted locally before network synchronization or retry.

The backend must enforce uniqueness within the correct account or installation scope.

The exact identifier format is an implementation choice, but it must be collision-resistant and stable across retries.

A new identifier must not be generated simply because a request timed out.

### 25.3 Idempotent processing

Conceptual behaviour:

```text
Receive simulation request
          |
          v
Check operation identifier
          |
     +----+----+
     |         |
  Existing   New
     |         |
     v         v
Return       Validate and
existing     process once
result          |
                v
             Persist result
                |
                v
             Return result
```

The server must return the original result for an already processed operation.

### 25.4 Reconciliation

When a local operation is uploaded, the backend must identify whether it has already been accepted.

If it has, the backend should return the existing transaction result and synchronization metadata.

The local client must then reconcile its state without applying the balance movement a second time.

---

# PART X — MONETIZATION AND PRICING

## 26. Monetization model

Paspesa will support two independent methods of paying for its simulation service:

1. Prepaid tokens.
2. Direct pay-per-simulation payment.

**AGREED:** A user chooses the payment method for each individual simulation.

The existence of an available token balance does not force the user to spend tokens.

A user may choose direct payment even when tokens are available or allocated to the current device.

### 26.1 Prepaid tokens

A user purchases a token package.

After successful payment verification, the backend credits the purchased tokens to the user's central token wallet.

When a simulation is paid for with tokens, the system calculates the required token cost and deducts the tokens from the correct source categories.

### 26.2 Direct pay-per-simulation

A user may pay for a particular simulation without spending prepaid tokens.

The backend calculates the price, obtains payment authorization and allows the simulation to proceed only after the payment is confirmed according to the selected payment provider's integration.

Direct pay-per-simulation requires connectivity for payment authorization.

### 26.3 Subscriptions

**DEFERRED:** Subscriptions are a very-late future feature. They are not part of the initial implementation scope.

The architecture may leave room for subscriptions, but the agent must not prioritize or implement a subscription system as part of the first release.

## 27. Pricing engine

The pricing engine must be configurable through the future admin backoffice.

It must support three pricing formula types.

### 27.1 Formula 1 — Full amount calculation

**AGREED DEFAULT**

The full simulated transaction amount is used for token calculation, except where the amount is within the configured free threshold.

Let:

- \(A\) = simulated transaction amount.
- \(F\) = free threshold.
- \(D\) = simulated amount represented by one token.

\[
T(A)=
\begin{cases}
0, & A \leq F\\
\lceil A/D \rceil, & A>F
\end{cases}
\]

Default values:

- Free threshold: KSh 20.
- Amount per token: KSh 5.
- Formula: Full amount calculation.

Examples:

| Simulation amount | Token cost |
|---:|---:|
| KSh 10 | 0 |
| KSh 20 | 0 |
| KSh 21 | 5 |
| KSh 25 | 5 |
| KSh 100 | 20 |
| KSh 500 | 100 |

The threshold and divisor must be configurable. The values above are the agreed defaults, not merely illustrative examples.

### 27.2 Formula 2 — Excess amount calculation

This formula deducts the free threshold from the simulated amount before calculating the token cost.

\[
T(A)=
\begin{cases}
0, & A \leq F\\
\lceil (A-F)/D \rceil, & A>F
\end{cases}
\]

This formula is configurable but is not the default.

### 27.3 Formula 3 — Tiered pricing

This formula uses administrator-configured amount ranges and token costs.

Example configuration:

| Amount range | Token cost |
|---|---:|
| KSh 0–20 | 0 |
| KSh 21–100 | Configured value |
| KSh 101–500 | Configured value |
| KSh 501–1,000 | Configured value |

The actual tiers must be editable. The example is not a finalized tier schedule.

### 27.4 Pricing hierarchy

The system must support global rules, transaction-type overrides and individual-account overrides.

Resolution precedence:

1. Individual account + transaction-type override.
2. Individual account default override.
3. Global transaction-type override.
4. Global default pricing.

For example, an individual account may have a special Send Money price while continuing to use the global Paybill price.

### 27.5 Pricing versioning

Every completed token-funded simulation must store:

- Pricing formula.
- Free threshold.
- Divisor or tier configuration.
- Resolved transaction-type rule.
- Account-specific override, if applicable.
- Configuration version.
- Calculated token cost.
- Timestamp of the applied configuration.

Changing the current pricing configuration must not alter historical simulation costs.

### 27.6 Backend authority

The backend is authoritative for online pricing and token deductions.

The client must not be trusted to choose its own token cost.

Offline token-funded operations must use the previously authorized pricing configuration associated with that device's valid allocation.

---

# PART XI — TOKEN WALLET AND ACCOUNTING

## 28. Central token wallet

**AGREED:** Paspesa uses one central token wallet with a complete ledger and source-aware token categories.

The wallet is not three independent wallets. It is one balance that internally tracks where tokens originated.

The three categories are:

1. Purchased tokens.
2. Promotional tokens.
3. Administrator-issued tokens.

Example:

| Token source | Quantity |
|---|---:|
| Purchased | 300 |
| Promotional | 100 |
| Admin-issued | 100 |
| **Total** | **500** |

The interface may show one total token balance and a category breakdown.

### 28.1 Token ledger

The token balance must be supported by a ledger of movements.

Ledger event types should include:

- Token purchase credit.
- Promotional grant.
- Administrator grant.
- Simulation expenditure.
- Expenditure reversal.
- Token refund.
- Device allocation.
- Device release.
- Expiration.
- Lost-device forfeiture.
- Administrative adjustment.

The system must not rely only on a mutable total-balance field.

### 28.2 Token deduction priority

**AGREED:** Deduct tokens in this order:

1. Promotional tokens first.
2. Administrator-issued tokens second.
3. Purchased tokens last.

Example:

| Source | Starting balance | Deduction | Remaining |
|---|---:|---:|---:|
| Promotional | 100 | 100 | 0 |
| Admin-issued | 100 | 20 | 80 |
| Purchased | 100 | 0 | 100 |
| **Total** | **300** | **120** | **180** |

The expenditure record must identify exactly which token sources funded the simulation.

### 28.3 Token expiry

**AGREED:**

- Purchased tokens do not expire by default.
- Promotional tokens may have an expiry.
- Administrator-issued tokens may have an expiry.
- Administrators can configure category expiry policies.
- Expiry must be tracked per token grant or credit lot.

When tokens expire, the system must:

1. Remove the expired quantity from the spendable balance.
2. Create a permanent ledger entry.
3. Record the token category.
4. Record the quantity.
5. Record the expiry date.
6. Record the original grant reference.
7. Preserve the event for audit and reconciliation.

Expired tokens must not disappear silently.

### 28.4 Token balance consistency

The wallet's displayed balance must be reconcilable from its ledger.

Token credits and debits must be recorded in a way that prevents double spending and duplicate processing.

The backend must enforce authoritative wallet accounting for online operations.

---

# PART XII — DEVICE-SPECIFIC TOKEN RESERVATIONS

## 29. Device allocation model

**AGREED:** Paspesa uses device-specific token reservations.

The central wallet remains the source of truth, but tokens allocated for offline use are reserved to a particular device installation.

Example:

- Central available token balance: 100.
- Phone A receives an allocation of 100.
- Phone A can spend those tokens while offline.
- Phone B cannot spend the same reserved tokens.

The system must not issue the same token allowance to two disconnected devices.

### 29.1 Allocation rules

1. A registered or otherwise recognized device may request an allocation while online.
2. The backend checks the available central wallet balance.
3. The backend reserves the requested available amount for that device.
4. The device receives an authorization record.
5. The device can use its allocation offline, subject to the authorization policy.
6. Other devices cannot spend the same reserved quantity.

The exact allocation interface and whether the user allocates all or part of the available balance should be implemented through the account/device management design.

### 29.2 Device switching

**AGREED:** Reallocation is online-only.

For Phone B to use tokens currently allocated to Phone A:

1. Phone A must connect to the internet.
2. Phone A releases its allocation.
3. The backend reconciles the device's recorded spending.
4. Confirmed unused tokens are returned to the central available balance.
5. Phone B requests and receives an allocation while online.
6. Phone B can then use its allocation offline.

A device must not be able to release an allocation that has not been reconciled safely.

### 29.3 Pay-per-simulation on another device

A device without a token allocation can still use direct pay-per-simulation while online.

The user may also select direct payment on a device that does have an allocation.

Token availability must not automatically determine the payment method.

### 29.4 Authorization duration

The normal offline authorization policy has a default duration of three days, configurable by administrators.

A successful online authorization renewal or synchronization refreshes the authorization period.

After the authorization period expires:

- The device cannot initiate further paid offline token simulations.
- Pending records remain on the device.
- Pending records may still be uploaded and reconciled.
- The allocation must not automatically be returned to the central wallet merely because the authorization period expired.

This prevents an expired offline device from continuing to spend indefinitely while preserving pending records for reconciliation.

### 29.5 Lost-device policy

If a device is permanently lost or cannot be recovered and its offline records cannot be obtained:

- The unreconciled allocation is treated as lost/forfeited.
- The system must not assume that the remaining allocation was unused.
- The system must not invent transaction records to explain the missing amount.
- The forfeiture must be recorded as a permanent ledger event.
- The event must identify the affected device and allocation.
- The recovery action must be controlled and auditable.

The exact user/admin recovery workflow can be designed during the device-management phase. It must preserve the accounting rule above.

### 29.6 Free simulations

The earlier suggestion that free simulations may remain available offline without a token allocation is a proposed policy, not a finalized entitlement rule.

The agent should not make this assumption part of monetized transaction authorization without product-owner approval.

---

# PART XIII — PAYMENT PROCESSING AND FAILURE HANDLING

## 30. Separation of Paspesa payments and simulated transactions

Paspesa has two different kinds of activity:

**Commercial payment**
- Purchasing Paspesa tokens.
- Paying directly for a Paspesa simulation.

**Simulated transaction**
- Sending simulated money.
- Paying a simulated Till or Paybill.
- Withdrawing simulated money.
- Recharging the simulated account.
- Other simulated account operations.

These must be represented as distinct records and workflows.

A successful commercial payment does not itself mean that the simulated transaction has succeeded.

## 31. Token purchase workflow

A future token purchase should follow this general process:

1. User selects a token package.
2. Backend calculates the package price.
3. User selects an available payment method.
4. Payment request is initiated.
5. Payment provider confirms the result.
6. Backend verifies the payment.
7. Backend creates a token-credit ledger entry.
8. Wallet balance is updated.
9. Purchase history is updated.
10. Client receives the confirmed wallet balance.

The client must not credit tokens based only on a locally displayed success screen or an unverified payment response.

## 32. Direct pay-per-simulation workflow

1. User initiates a simulation.
2. Paspesa calculates the applicable price.
3. User chooses direct payment.
4. Backend creates a payment attempt associated with the simulation identifier.
5. Payment provider processes the commercial payment.
6. Backend verifies the payment result.
7. Simulation is authorized.
8. Simulation is processed exactly once.
9. The payment and simulation records are linked.
10. The result is returned to the client.

Payment attempts and simulation records must have separate identifiers and statuses.

A retry must not charge the user twice or process the same simulation twice.

## 33. Direct-payment failure protection

**AGREED:** If Paspesa receives a direct payment but the associated simulation fails because of a technical error, the user must not lose the payment.

Paspesa must provide a refund or refundable payment credit.

The exact mechanism remains an implementation choice to be finalized against the payment provider's capabilities:

- Refund to the original payment method.
- Refundable account credit.
- A configurable mechanism based on the provider and payment method.

The system must preserve the payment record and link it to the failed simulation.

It must not silently treat the payment as a successful simulation.

### 33.1 Failure states

At minimum, distinguish:

- Payment initiated.
- Payment pending.
- Payment successful.
- Payment failed.
- Simulation authorized.
- Simulation processing.
- Simulation successful.
- Simulation failed.
- Refund pending.
- Refunded.
- Refundable credit issued.

A payment provider timeout must not automatically be treated as a failed payment. The backend should verify the actual payment status before retrying or issuing a refund.

### 33.2 Token-funded failure

Only successfully completed simulations should consume tokens.

If tokens are provisionally deducted and the simulation fails:

- Restore the token entitlement.
- Create a separate reversal ledger entry.
- Preserve the original deduction.
- Do not erase the original ledger movement.

The same principle applies to offline token-funded simulations, with local records reconciled when the device reconnects.

---

# PART XIV — ADMIN BACKOFFICE

## 34. Administrative system

The admin backoffice is an important part of the Paspesa platform.

It should eventually provide centralized management of business configuration, users, token accounting, payment operations and system monitoring.

The initial simulator may not require the complete backoffice UI, but its architecture must allow the backend to control configuration centrally.

## 35. Administrative capabilities

The planned backoffice should support the following areas.

### 35.1 Pricing management

- Global pricing formula.
- Free threshold.
- Amount-per-token divisor.
- Tiered pricing configuration.
- Transaction-type overrides.
- Individual account overrides.
- Pricing configuration versions.
- Effective dates.
- Audit history.

### 35.2 Transaction fee management

- Fee schedules.
- Transaction-type assignments.
- Amount ranges.
- Fee values.
- Effective dates.
- Active/inactive schedules.
- Historical configuration versions.

### 35.3 Token packages

- Create and edit packages.
- Set token quantity.
- Set commercial price.
- Activate/deactivate packages.
- Track purchases.
- Manage package availability.

### 35.4 Wallet management

- View token balances.
- View category breakdown.
- Issue promotional tokens.
- Issue administrator tokens.
- Apply controlled adjustments.
- Review token expenditure.
- Review reversals and expirations.
- Inspect ledger entries.

### 35.5 User and account management

Future capabilities should include:

- View registered accounts.
- View account status.
- Restrict or restore access.
- Review account activity.
- Manage account-specific pricing.
- Inspect device registrations.

### 35.6 Device management

- View registered devices.
- View device allocation.
- Review allocation and release history.
- Reconcile device spending.
- Handle lost-device recovery.
- Apply authorization policies.
- Review device synchronization state.

### 35.7 Payment operations

- View token purchases.
- View direct-payment attempts.
- Verify payment status.
- Review failed simulations.
- Manage refund or refundable-credit cases.
- Reconcile payment records.

### 35.8 Reports and audit logs

- Transaction volume.
- Token sales.
- Token expenditure.
- Promotional token grants.
- Payment success and failure.
- Simulation failures.
- Synchronization failures.
- Administrative changes.
- Device allocations and forfeitures.

### 35.9 Permissions and auditability

Administrative operations that affect money-like simulator entitlements or business configuration must be permission-controlled and auditable.

The exact administrator roles and permission matrix can be designed during the backoffice phase.

---

# PART XV — DATA MODEL AND PERSISTENCE REQUIREMENTS

## 36. General data principles

The data model must support:

- Local-first operation.
- Backend synchronization.
- Multi-device account ownership.
- Transaction idempotency.
- Historical records.
- Token accounting.
- Fee and pricing versioning.
- Administrative auditability.
- Future authentication.

The following is a conceptual domain model, not a demand to use these exact table names.

## 37. Core entities

### 37.1 Account

Represents the simulated mobile-money account.

Suggested fields:

- `id`
- `owner_id` or local installation owner
- `account_name`
- `phone_number`
- `opening_balance`
- `current_balance_cache`
- `currency`
- `created_at`
- `updated_at`
- `version`

### 37.2 Account balance movement

Represents a recorded change in the simulated balance.

Suggested fields:

- `id`
- `account_id`
- `transaction_id`
- `movement_type`
- `amount`
- `direction`
- `balance_before`
- `balance_after`
- `created_at`
- `source_reference`

A recharge, debit, credit or reversal should be represented by an auditable movement.

### 37.3 Transaction

Suggested fields:

- `id`
- `account_id`
- `operation_id`
- `transaction_type`
- `status`
- `amount`
- `fee`
- `total_debit`
- `sender_name`
- `sender_phone`
- `recipient_name`
- `recipient_phone`
- `till_number`
- `paybill_number`
- `account_reference`
- `balance_before`
- `balance_after`
- `fee_schedule_version`
- `pricing_configuration_version`
- `created_at`
- `completed_at`
- `sync_status`
- `metadata`

Not every field applies to every transaction type. Type-specific information may be represented through validated structured data.

### 37.4 Message

Suggested fields:

- `id`
- `transaction_id`
- `message_type`
- `template_version`
- `body`
- `created_at`
- `read_at`
- `sync_status`

### 37.5 Statement

Statements may be generated from transactions rather than stored as independently mutable financial records.

If statement snapshots or exports are stored, they should retain their date range and generation metadata.

### 37.6 Fee schedule

Suggested fields:

- `id`
- `name`
- `transaction_type`
- `version`
- `effective_from`
- `effective_to`
- `status`
- `created_at`

A related fee-band structure should store:

- Minimum amount.
- Maximum amount.
- Fee amount.

### 37.7 Pricing configuration

Suggested fields:

- `id`
- `scope_type`
- `scope_id`
- `transaction_type`
- `formula_type`
- `free_threshold`
- `amount_per_token`
- `tier_configuration`
- `version`
- `effective_from`
- `effective_to`
- `status`

### 37.8 Token wallet

Suggested fields:

- `id`
- `owner_id`
- `total_balance_cache`
- `purchased_balance_cache`
- `promotional_balance_cache`
- `admin_balance_cache`
- `version`
- `updated_at`

The ledger remains the accounting source of truth.

### 37.9 Token ledger entry

Suggested fields:

- `id`
- `wallet_id`
- `entry_type`
- `source_category`
- `quantity`
- `direction`
- `reference_type`
- `reference_id`
- `grant_lot_id`
- `device_id`
- `created_at`
- `expires_at`
- `metadata`

### 37.10 Token grant lot

Tracks the source and expiry of a particular token credit.

Suggested fields:

- `id`
- `wallet_id`
- `source_category`
- `original_quantity`
- `remaining_quantity`
- `created_at`
- `expires_at`
- `source_reference`

### 37.11 Device

Suggested fields:

- `id`
- `owner_id`
- `installation_id`
- `device_label`
- `platform`
- `registered_at`
- `last_seen_at`
- `status`

Device identity should be installation-specific, not merely based on a device model.

### 37.12 Device token allocation

Suggested fields:

- `id`
- `wallet_id`
- `device_id`
- `allocated_quantity`
- `spent_quantity`
- `released_quantity`
- `authorization_started_at`
- `authorization_expires_at`
- `last_renewed_at`
- `status`
- `created_at`
- `released_at`

### 37.13 Payment

Suggested fields:

- `id`
- `owner_id`
- `payment_type`
- `provider`
- `provider_reference`
- `idempotency_key`
- `amount`
- `currency`
- `status`
- `related_simulation_id`
- `created_at`
- `verified_at`
- `refund_status`

### 37.14 Synchronization outbox

Suggested fields:

- `id`
- `installation_id`
- `operation_id`
- `entity_type`
- `entity_id`
- `operation_type`
- `payload_version`
- `created_at`
- `attempt_count`
- `last_attempt_at`
- `status`
- `last_error`

### 37.15 Audit log

Suggested fields:

- `id`
- `actor_id`
- `action`
- `entity_type`
- `entity_id`
- `before_value`
- `after_value`
- `created_at`
- `reason`

Sensitive data must not be copied unnecessarily into audit records.

## 38. Financial consistency

The system must have one authoritative way to derive the account balance.

A recommended approach is:

\[
\text{Current balance}=
\text{Opening balance}+
\sum \text{credits}-
\sum \text{debits}
\]

A cached balance can be maintained for performance, but it must be reconcilable with the underlying movements.

The same principle applies to the token wallet:

\[
\text{Token balance}=
\text{valid credits}-
\text{expenditures}-
\text{expirations}-
\text{forfeitures}+
\text{reversals}
\]

The exact accounting implementation may vary, but the ledger must make the result auditable.

---

# PART XVI — API AND BACKEND REQUIREMENTS

## 39. API design principles

The backend API should expose explicit operations rather than allowing clients to directly overwrite financial state.

Possible endpoint groups include:

| Area | Example operations |
|---|---|
| Accounts | Create local/account record, retrieve account, retrieve balance |
| Recharges | Create recharge, retrieve recharge history |
| Transactions | Create simulation, retrieve transaction, list history |
| Messages | List messages, retrieve message, update read state |
| Statements | Retrieve statement data, request export |
| Synchronization | Submit pending operations, retrieve changes, reconcile |
| Pricing | Retrieve active pricing configuration |
| Wallet | Retrieve token wallet and ledger |
| Token packages | List packages, initiate purchase |
| Device allocations | Request allocation, release allocation, renew authorization |
| Payments | Initiate payment, verify payment, retrieve status |
| Administration | Manage configuration, users, devices and audit records |

These are conceptual endpoint groups. The agent should define the actual REST paths and request/response schemas during implementation.

### 39.1 Server-side validation

The backend must independently validate:

- Transaction type.
- Required fields.
- Amount and range constraints.
- Fee schedule.
- Balance impact.
- Operation identifier.
- Payment authorization.
- Token availability.
- Device allocation.
- Pricing configuration.
- Account ownership and authorization.

The client must not be trusted to submit an arbitrary resulting balance or token balance.

### 39.2 Versioning

API contracts and payload formats should be versioned where necessary.

Offline clients may reconnect after an application update. The backend should be able to recognize supported payload versions and handle migration or reject unsupported formats clearly.

### 39.3 Error responses

Errors should be structured and distinguish:

- Validation error.
- Insufficient simulated balance.
- Insufficient token allocation.
- Payment pending.
- Payment failed.
- Authorization expired.
- Duplicate operation.
- Synchronization conflict.
- Server failure.
- Unsupported operation version.

The UI should display clear, non-technical explanations while preserving diagnostic details for logs.

---

# PART XVII — USER INTERFACE AND REFERENCE SCREENS

## 40. Visual direction

The supplied screenshots are reference material for layout, hierarchy, interaction patterns and transaction journey structure.

They show examples of:

- Home dashboard.
- Balance cards.
- Quick actions.
- Lipa na M-PESA category.
- Buy Goods selection.
- Till number and merchant details.
- Amount entry.
- Payment method selection.
- Confirmation.
- PIN-entry-style confirmation.
- Successful transaction result.
- Statement options and transaction listing.

The screenshots are not authorization to copy Safaricom's logos, brand marks, exact proprietary assets or claim that Paspesa is an official Safaricom product.

Paspesa must use its own branding and visual language.

## 41. Reference-screen handling

The product owner will provide further references during development, including:

- Additional transaction screens.
- Paybill journey.
- Pochi journey.
- Message templates and examples.
- Messages page.
- Statement example and any additional statement behaviour.
- Other relevant screen states.

The agent must request a reference when it reaches a screen or workflow whose exact design or content has not been supplied.

The request should identify precisely what is missing, for example:

- Which screen.
- Which transaction type.
- Which state.
- Which field or message.
- Which interaction.
- Whether a light or dark version is required.

The agent should not block unrelated work while waiting for a reference that is not yet needed.

## 42. UI states

Every major screen should account for:

- Initial/loading state.
- Normal state.
- Empty state.
- Validation error state.
- Processing state.
- Success state.
- Failure state.
- Offline state.
- Pending synchronization state.
- Disabled or unavailable action state.

The interface should communicate when an action is unavailable because of connectivity, authorization or missing information.

## 43. Accessibility and responsive behaviour

The interface should be usable across supported screen sizes.

The implementation should include:

- Readable text sizes.
- Clear contrast.
- Accessible labels.
- Logical keyboard navigation on web.
- Appropriate touch targets on mobile.
- Form validation feedback.
- Responsive layouts.
- Consistent spacing and component behaviour.

---

# PART XVIII — SECURITY, PRIVACY AND RELIABILITY

## 44. Security principles

Even though Paspesa simulates transactions, its accounts, user data, token wallet and commercial payment records require proper protection.

The system should implement:

- Secure authentication when introduced.
- Authorization checks on protected backend operations.
- Server-side ownership validation.
- Secure handling of payment-provider credentials.
- Environment-based secret management.
- Input validation and output encoding.
- Protection against duplicate requests.
- Rate limiting for sensitive online endpoints.
- Secure transport for backend communication.
- Appropriate local data protection.
- Audit logs for sensitive administrative actions.

### 44.1 No real M-PESA PIN collection

Paspesa must never ask users to enter or store their actual M-PESA PIN.

Any PIN-like interaction must be a Paspesa-only simulation mechanism and must not be sent to Safaricom.

### 44.2 Sensitive information

The application should collect only information needed for its simulator functions.

Phone numbers and other personal data should be handled carefully, with appropriate access controls and retention practices.

### 44.3 Administrative security

Administrative capabilities must not be exposed to ordinary users.

The backend must enforce permissions, not merely hide administrative UI elements.

## 45. Reliability

The system must be resilient to:

- App restarts.
- Network interruptions.
- Server timeouts.
- Repeated requests.
- Duplicate synchronization.
- Partial failures.
- Local database errors.
- Payment-provider delays.
- Configuration changes.

Errors must be recoverable where possible. The application must not silently discard pending transactions or financial records.

## 46. Logging and observability

The system should maintain useful logs for:

- Transaction processing.
- Failed operations.
- Synchronization attempts.
- Duplicate requests.
- Payment attempts.
- Token deductions and reversals.
- Device allocation and release.
- Administrative changes.

Logs must not expose secrets, real PINs or unnecessary sensitive user data.

---

# PART XIX — TESTING AND ACCEPTANCE

## 47. Testing strategy

Testing must cover both the visible application and the underlying business rules.

The agent should add automated tests for the core domain logic and integration tests for important backend workflows.

### 47.1 Transaction engine tests

Verify:

- Required fields are validated.
- Invalid amounts are rejected.
- Correct fee schedules are selected.
- Correct fee bands are applied.
- Balance impacts are correct.
- Successful transactions create records.
- Corresponding messages are generated.
- Failed operations do not leave partial financial state.
- Retries do not duplicate operations.

### 47.2 Recharge tests

Verify:

- A recharge adds to the previous balance.
- A recharge does not overwrite the existing balance.
- Default sender details are applied when no custom sender is supplied.
- Custom sender name and phone number are retained.
- Recharge creates an incoming transaction record.
- Recharge creates the corresponding message.
- Repeated submissions with the same operation ID do not add the amount twice.

### 47.3 Fee schedule tests

Verify all fee-band boundaries, including values immediately below, at and above each range boundary.

Verify:

- Send Money uses the configured Send Money schedule.
- Pochi uses the same Paspesa Send Money schedule.
- Paybill uses the same Paspesa Send Money schedule.
- Buy Goods has a zero customer fee.
- Withdraw uses the withdrawal schedule.
- Unsupported values are rejected or handled through explicit configured rules.

### 47.4 Pricing tests

Verify:

- Full amount formula is the default.
- Default free threshold is KSh 20.
- Default divisor is KSh 5 per token.
- Amounts at or below KSh 20 cost zero tokens.
- KSh 100 costs 20 tokens under the default formula.
- Excess amount formula works when selected.
- Tiered pricing works from configured ranges.
- Account and transaction-type overrides follow the defined precedence.
- Historical simulations retain the pricing version used.

### 47.5 Token ledger tests

Verify:

- Token credits update the correct source category.
- Deduction priority is promotional, admin-issued, purchased.
- Expenditure records identify the sources used.
- Reversals restore the correct category quantities.
- Expiration creates a permanent ledger event.
- Lost-device forfeiture is recorded without inventing expenditure.
- Wallet totals reconcile with ledger entries.

### 47.6 Idempotency tests

Simulate repeated submissions and network retries.

Verify that one operation ID results in only one:

- Transaction.
- Balance movement.
- Message.
- Token expenditure.
- Direct payment charge.
- Statement entry.

### 47.7 Offline and synchronization tests

Verify:

- Ordinary eligible operations work without internet.
- Data persists after app restart.
- Pending records are retained.
- Reconnection uploads pending operations.
- Repeated synchronization does not duplicate records.
- The backend returns existing results for duplicate operation IDs.
- Multi-device synchronization does not silently overwrite records.
- Conflicts are preserved and surfaced for review.

### 47.8 Payment failure tests

Verify:

- Unverified payment does not credit tokens.
- Successful payment is linked to its purchase or simulation.
- Failed simulation after successful direct payment creates a refundable outcome.
- A timeout is not incorrectly treated as a confirmed payment failure.
- Repeated payment callbacks do not create duplicate credits or charges.

## 48. Initial acceptance criteria

The initial simulator foundation should not be considered complete until:

1. The application starts and its navigation works.
2. Account data persists.
3. Opening balance can be established.
4. General Operations recharge adds to the previous balance.
5. Recharge is recorded as incoming activity.
6. At least the agreed initial transaction journeys are integrated with the central engine.
7. Fee schedules are centralized and correct.
8. Buy Goods uses zero customer fee.
9. Transaction records are persisted.
10. Successful transactions update the simulated balance correctly.
11. Messages correspond to the correct transactions.
12. History reflects the transaction ledger.
13. Statements derive from the correct transaction data.
14. Restarting the application does not erase saved information.
15. Idempotency protection exists in the transaction and synchronization design.
16. Offline operation is supported for the initial eligible simulator workflows.
17. The backend synchronization foundation is functional or has a documented, tested implementation boundary.
18. Automated tests cover critical transaction and balance rules.

The agent must report any acceptance criterion that is not included in the delivered scope and explain why.

---

# PART XX — DEVELOPMENT PLAN

## 49. Development principles

The agent must work in the actual repository and integrate changes into the project.

It must not merely provide code snippets in chat or claim that functionality is complete when only a mock screen has been created.

The agent must:

- Inspect the existing repository before changing it.
- Preserve useful existing functionality.
- Avoid unnecessary rewrites.
- Use the White Paper as the product source of truth.
- Keep business logic separate from presentation.
- Test changes.
- Report completed and incomplete work honestly.
- Request missing visual references when needed.
- Ask for approval before changing agreed product rules.

## 50. Recommended development phases

### Phase 0 — Repository assessment

- Inspect the repository.
- Identify the current stack and architecture.
- Review existing functionality.
- Identify reusable components.
- Identify missing infrastructure.
- Propose the implementation sequence.
- Confirm how the current codebase maps to this White Paper.

No major rewrite should happen before this assessment.

### Phase 1 — Application foundation

- Establish the application shell.
- Set up navigation.
- Establish theme and reusable components.
- Set up local persistence.
- Define shared domain types.
- Define account and transaction data structures.
- Establish validation and error-handling conventions.

### Phase 2 — Account and General Operations

- Implement account information.
- Implement opening balance.
- Implement account recharge.
- Support default Paspesa sender details.
- Support custom sender details.
- Record incoming transactions.
- Update the balance correctly.
- Generate and save recharge messages.

### Phase 3 — Transaction engine and initial journeys

- Implement the central transaction engine.
- Implement shared fee resolution.
- Implement Send Money.
- Implement Buy Goods.
- Implement Pochi.
- Implement Paybill.
- Implement Withdraw.
- Implement Airtime and other agreed initial operations according to the supplied references.
- Implement confirmation and result handling.
- Add idempotency protection.

### Phase 4 — Messages, history and statements

- Implement the message system.
- Integrate messages with transactions.
- Implement transaction history.
- Implement date grouping and search.
- Implement transaction details.
- Implement statements and relevant filters.
- Verify balance and statement consistency.

### Phase 5 — Backend persistence and synchronization

- Implement backend account persistence.
- Implement synchronization APIs.
- Implement synchronization outbox.
- Implement retry-safe uploads.
- Implement backend deduplication.
- Implement reconciliation.
- Verify offline and online behaviour.

### Phase 6 — Monetization foundation

- Implement pricing engine.
- Seed the agreed default pricing configuration.
- Implement token wallet and ledger.
- Implement token deduction priority.
- Implement token expenditure and reversal.
- Implement token grant categories and expiry.
- Implement payment record structures.

Actual payment provider integration and commercial payment activation should follow a separate controlled implementation and testing stage.

### Phase 7 — Device allocation and administration

- Implement device registration.
- Implement token reservations.
- Implement release and reallocation.
- Implement authorization renewal and expiry.
- Implement lost-device handling.
- Implement admin configuration and audit controls.

### Phase 8 — Expansion and refinement

- Additional clients.
- Full authentication and account recovery.
- Advanced statement tools.
- More transaction types.
- Advanced administration and reporting.
- Additional monetization capabilities.
- Subscription support as a very-late feature.

These phases are a recommended sequence. The product owner may adjust priorities without changing the underlying agreed rules.

---

# PART XXI — OPEN AND DEFERRED IMPLEMENTATION ITEMS

## 51. Items that can be decided during implementation

The following are implementation details that should not block the initial simulator foundation:

- Exact repository folder names.
- Exact REST endpoint paths.
- Database naming conventions.
- Internal service and class names.
- Exact local database library, subject to architecture review.
- Exact UI component library.
- Exact transaction identifier format.
- Exact synchronization batch size and retry schedule.
- Exact admin UI layout.
- Exact payment provider and commercial payment integration.
- Exact statement export formats.
- Exact message template structure.

The agent should choose maintainable solutions and document significant technical decisions.

## 52. Items requiring product-owner input when encountered

The agent should request input when it reaches:

- A transaction screen whose required visual reference has not been supplied.
- A message template whose exact wording is not available.
- A transaction-specific field that cannot be inferred safely.
- A material change to an agreed fee or pricing rule.
- A change to transaction behaviour or balance treatment.
- A payment-provider decision.
- A user-facing policy that is not specified here.
- A feature that could affect financial or token accounting in an irreversible way.

The agent should ask focused questions, not send a large questionnaire.

## 53. Deferred features

The following are not initial-release priorities:

- Subscription plans.
- Full multi-device account management UI.
- Complete administrative reporting suite.
- Advanced device recovery UI.
- Additional transaction types not yet prioritized.
- Advanced payment-provider integrations.
- Full account recovery and registration flows.
- Additional platforms beyond the first delivery target.

The architecture should allow these features to be added later.

---

# PART XXII — DECISION REGISTER

## 54. Confirmed decisions

| Area | Decision | Status |
|---|---|---|
| Product | Paspesa is a simulator, not a real M-PESA payment service | AGREED |
| Branding | Use original Paspesa identity and assets | AGREED |
| Multi-client vision | Mobile, PWA and desktop web supported by shared logic | AGREED |
| Offline-first | Core architectural requirement from the beginning | AGREED |
| Authentication | Registration/login can come later | AGREED |
| Account recharge | Recharge from Accounts / General Operations | AGREED |
| Recharge sender | Default sender is Paspesa; custom sender name and phone supported | AGREED |
| Recharge balance | New balance equals previous balance plus recharge amount | AGREED |
| Transaction engine | Shared central transaction engine | AGREED |
| Fee schedule | Send Money schedule reused for Send Money, Pochi and Paybill | AGREED |
| Buy Goods | Zero customer fee in Paspesa | AGREED |
| Withdraw | Use agent-withdrawal fee schedule | AGREED |
| Pricing formulas | Full amount, excess amount and tiered pricing configurable | AGREED |
| Default pricing formula | Full amount calculation | AGREED |
| Default free threshold | KSh 20, adjustable | AGREED |
| Default token divisor | KSh 5 per token, adjustable | AGREED |
| Monetization | Prepaid tokens and direct pay-per-simulation | AGREED |
| Payment selection | User chooses payment method per simulation | AGREED |
| Subscriptions | Very-late future feature | DEFERRED |
| Wallet | One central source-aware token wallet | AGREED |
| Token categories | Purchased, promotional, admin-issued | AGREED |
| Deduction priority | Promotional, admin-issued, purchased | AGREED |
| Token expiry | Purchased tokens no expiry by default; promotional/admin tokens may expire | AGREED |
| Device allocation | Device-specific token reservations | AGREED |
| Device switching | Online-only; previous device releases first | AGREED |
| Authorization period | Default three days, admin configurable | AGREED |
| Authorization renewal | Successful online renewal refreshes authorization period | AGREED |
| Expiry behaviour | Stop new paid offline token simulations; preserve pending records | AGREED |
| Lost device | Unreconciled allocation forfeited if records cannot be recovered | AGREED |
| Direct payment failure | Refund or refundable credit if payment received but simulation fails technically | AGREED |
| Token-funded failure | Failed simulations do not permanently consume tokens | AGREED |
| Idempotency | Unique simulation identifier and duplicate protection online/offline | AGREED |
| Statements | Derived from underlying transaction records | SPECIFIED |
| Messages | Linked to transaction records | SPECIFIED |

## 55. Implementation choices not yet fixed

The following must not be falsely represented as finalized product decisions:

- Final technology stack after repository assessment.
- Exact payment provider.
- Exact token package prices and quantities.
- Exact payment refund mechanism supported by the chosen provider.
- Exact admin roles and permission matrix.
- Exact statement export formats.
- Exact additional transaction catalogue beyond the initial scope.
- Exact UI screens not yet supplied.
- Exact message templates not yet supplied.
- Exact lost-device declaration and review interface.

---

# PART XXIII — EXTERNAL AND VISUAL REFERENCES

## 56. Tariff reference sources

The initial reference schedules were checked against published 2026 tariff summaries that report verification against Safaricom's consumer tariff information.

Reference sources:

- Shmoney, *M-PESA Charges 2026: Full Send, Withdrawal & Fuliza Fee Table*, updated 13 June 2026 and reporting tariff verification on 4 November 2026: https://www.shmoney.co.ke/blog/mpesa-charges-kenya/
- SwiftPesa, *M-Pesa Charges Calculator*, rates checked 25 September 2026: https://swiftpesa.co.ke/calculator/mpesa-charges-calculator/
- PesaNews, *M-Pesa Charges 2026*, updated 21 October 2026: https://pesanews.co.ke/mpesa-charges/
- VoyageWindow, *M-Pesa for Tourists in Kenya*, tariff details and Pochi promotional context: https://voyagewindow.com/destinations/kenya/nairobi/guides/mpesa-for-visitors-in-kenya/

The tariff values in Sections 14 and 15 are the Paspesa reference configuration. They should be reviewed if the simulator's reference tariff data is updated. The Paspesa rule that applies the Send Money schedule to Pochi and Paybill is a deliberate product decision, not a claim about the actual tariff structure of those services.

## 57. Visual references

The product owner has supplied screenshots showing:

- Home dashboard.
- Lipa na M-PESA category.
- Buy Goods form.
- Confirmation page.
- PIN-entry-style screen.
- Successful transaction page.
- Statement page.

These screenshots are to be used as UX references while preserving Paspesa's original identity.

Additional screenshots and message examples will be supplied during development as required.

---

# PART XXIV — FINAL DEVELOPMENT INSTRUCTIONS

## 58. Instructions to the implementation agent

The implementation agent must treat this document as the primary specification.

Before coding:

1. Read the entire White Paper.
2. Inspect the complete repository.
3. Identify the existing architecture and working features.
4. Map the repository to the requirements in this document.
5. Report gaps, risks and reusable code.
6. Present a practical implementation plan.

During development:

1. Work in the actual project files.
2. Preserve useful existing functionality.
3. Implement the agreed business rules exactly.
4. Keep business logic reusable and separate from the UI.
5. Use the central transaction engine.
6. Maintain consistency between balance, ledger, history, messages and statements.
7. Implement idempotency before relying on retries or synchronization.
8. Test critical business rules.
9. Ask for missing screen and message references when needed.
10. Do not silently invent product decisions.

At each milestone, report:

- What was implemented.
- Which files or modules changed.
- What tests were run.
- What passed and failed.
- What remains incomplete.
- What input is needed from the product owner.

Do not claim that a feature is complete when it is only a static UI, mock response or local placeholder.

## 59. Definition of success

Paspesa's foundation will be successful when it behaves as one coherent simulator rather than a collection of unrelated screens.

A user should be able to establish an account balance, recharge it, perform supported simulated transactions, see the correct balance changes, receive the corresponding simulated messages, review the transaction history and statements, and retain the data across application restarts.

The architecture must support offline-first operation, reliable synchronization, future multi-device use, duplicate protection and the planned monetization model without compromising the integrity of the simulator.

**This White Paper is the baseline development specification. Any material change to an agreed requirement must be discussed with and approved by the product owner.**