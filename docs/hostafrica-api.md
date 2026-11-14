# HostAfrica Public API — endpoint inventory

Source: OpenAPI spec 1.1.0 - 2026-07-16 (downloaded from HostAfrica, saved to Downloads).
Base URL: `https://api.hostafrica.com/` · Auth: `Authorization: Bearer <token>` (Client Area → API settings; rotate/revocable there) · Rate limited (429 + Retry-After; SDKs retry).

## Priority endpoints for DevRelay ops

| Purpose | Endpoint |
|---|---|
| List all VPS services (verify 208213 vs 208214) | `POST /vps/list-vps-services` |
| Identify a service before touching it | `POST /vps/get-details` |
| **Cancel the duplicate VPS (208214)** — destructive, explicit go-ahead required | `POST /vps/cancel` |
| Verify invoice 1883694 stays unpaid | `POST /billing/list-invoices` → `POST /billing/get-invoice-details` |
| DNS automation for zones hosted at HostAfrica | `POST /dns/*` |
| Domain management (HostAfrica as registrar — future alternative to ResellerClub) | `POST /domain/*` |

## Backups (8)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/create-backup` | `CreateBackup` | `service_id` | Creates a new backup for a VPS service |
| `POST /vps/create-backup-schedule` | `CreateBackupSchedule` | `compress`, `dow`, `mode`, `service_id`, `starttime` | Creates a new backup schedule for a VPS service |
| `POST /vps/delete-backup` | `DeleteBackup` | `backup_id`, `service_id` | Deletes a specific backup from a VPS service |
| `POST /vps/delete-backup-schedule` | `DeleteBackupSchedule` | `schedule_id`, `service_id` | Deletes a backup schedule from a VPS service |
| `POST /vps/edit-backup-schedule` | `EditBackupSchedule` | `compress`, `dow`, `mode`, `schedule_id`, `service_id`, `starttime` | Edits an existing backup schedule for a VPS service |
| `POST /vps/list-backup-schedules` | `ListBackupSchedules` | `service_id` | Retrieves the list of backup schedules for a VPS service |
| `POST /vps/list-backups` | `ListBackups` | `service_id` | Retrieves the list of backups for a VPS service including quota information and backup configuration options |
| `POST /vps/restore-backup` | `RestoreBackup` | `backup_id`, `service_id` | Restores a VPS from a backup with the specified backup identifier |

## Billing (2)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /billing/get-invoice-details` | `GetInvoiceDetails` | `invoice_id` | Gets details for a single invoice, including line items, payee information, and transactions |
| `POST /billing/list-invoices` | `ListInvoices` | — | Lists invoices for the authenticated user |

## Console Access (1)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/novnc-console` | `GetNoVncConsole` | `service_id` | Retrieves noVNC console access credentials and connection details for a VPS |

## DNS (12)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /dns/add-record` | `AddDnsRecord` | `record` | Adds a DNS record to a zone. Legacy callers pass zone_id only (DNS Manager v1). For DirectAdmin, pass backend=directadmin with domain_id; upstream v2 receives domain_id and reco… |
| `POST /dns/create-rdns-record` | `CreateRdnsRecord` | `hostname`, `ip`, `relid`, `type` | Creates (or upserts) a PTR record for the authenticated client. If the client already owns a PTR for the same (serverid, ip) it is updated in place; if another client owns it a … |
| `POST /dns/create-zone` | `CreateDnsZone` | `domain_id`, `zone_ip` | Creates a DNS zone for an owned domain. Prefer list-dns-create-candidates first. domain_id and zone_ip are required. Also send service_id from hosting_id when the domain has lin… |
| `POST /dns/delete-rdns-record` | `DeleteRdnsRecord` | `record_id` | Deletes a PTR (rDNS) record owned by the authenticated client |
| `POST /dns/delete-record` | `DeleteDnsRecord` | `record` | Deletes a DNS record from a zone. Legacy callers pass zone_id only (DNS Manager v1). For DirectAdmin, pass backend=directadmin with domain_id; upstream v2 receives domain_id and… |
| `POST /dns/delete-zone` | `DeleteDnsZone` | `zone_id` | Deletes a live DNS Manager zone (all records). zone_id from list-dns-zones is required. Optional domain_id/service_id are forwarded when present. DirectAdmin rows with null zone… |
| `POST /dns/edit-rdns-record` | `EditRdnsRecord` | `hostname`, `record_id` | Updates the hostname and optional TTL of a PTR (rDNS) record owned by the authenticated client. The record_id remains valid after the call. |
| `POST /dns/edit-record` | `EditDnsRecord` | `record` | Edits a DNS record in a zone. Legacy callers pass zone_id only (DNS Manager v1). For DirectAdmin, pass backend=directadmin with domain_id; upstream v2 receives domain_id and rec… |
| `POST /dns/get-zone` | `GetDnsZoneDetails` | `domain_id` | Retrieves DNS zone details and records for an owned domain. Omit backend for the legacy DNS Manager (v1) path; set backend from list-dns-zones to route DirectAdmin zones to v2. |
| `POST /dns/list-create-candidates` | `ListDnsCreateCandidates` | — | Lists domains and services eligible for new DNS zone creation. |
| `POST /dns/list-rdns-records` | `ListRdnsRecords` | — | Lists all rDNS (PTR) records and available services for the authenticated client |
| `POST /dns/list-zones` | `ListDnsZones` | — | Lists DNS zones belonging to the authenticated client. Use each row's ids on later calls: domain_id preferred; zone_id for dns_manager record/zone mutations; hosting_id as servi… |

## Domains (21)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /domain/add-dnssec-record` | `AddDnssecRecord` | `alg`, `digest`, `digest_type`, `domain_id`, `key_tag` | Adds a DNSSEC DS record for an owned domain on supported registrars. |
| `POST /domain/add-redirect` | `AddDomainRedirect` | `domain_id`, `type`, `url` | Creates or updates HTTP redirect configuration for an owned domain. Upstream may create a DNS zone and point @/www A records at the redirector. If conflicting A records exist, r… |
| `POST /domain/check-availability` | `CheckDomainAvailability` | — | Use to check availability/pricing for known domain names. Pass exactly one of domain or domains (comma-separated, max 20); API rejects both omitted or both set. Optional currenc… |
| `POST /domain/delete-dnssec-record` | `DeleteDnssecRecord` | `alg`, `digest`, `digest_type`, `domain_id`, `key_tag` | Removes a DNSSEC DS record from an owned domain on supported registrars. |
| `POST /domain/delete-private-nameserver` | `DeletePrivateNameserver` | `domain_id`, `nameserver` | Deletes a private/child nameserver glue host for an owned domain. |
| `POST /domain/delete-redirect` | `DeleteDomainRedirect` | `domain_id` | Removes redirect configuration for an owned domain from the redirector service. DNS records and zones are not modified. |
| `POST /domain/get-domain` | `GetDomain` | `domain_id` | Gets details for an owned domain. |
| `POST /domain/get-domain-contacts` | `GetDomainContacts` | `domain_id` | Retrieves WHOIS contact information for an owned domain. Contact field names vary by TLD and registrar; use the returned structure when building custom contact update payloads. |
| `POST /domain/get-redirect-details` | `GetDomainRedirectDetails` | `domain_id` | Retrieves redirect configuration and DNS readiness flags for an owned domain. |
| `POST /domain/list-dnssec-records` | `ListDnssecRecords` | `domain_id` | Lists DNSSEC DS records configured for an owned domain. |
| `POST /domain/list-domains` | `ListDomains` | — | List all domains belonging to the authenticated client. |
| `POST /domain/list-domains-requiring-data` | `ListDomainsRequiringData` | — | Lists domains belonging to the authenticated client that require additional registrar or contact data. |
| `POST /domain/list-redirects` | `ListDomainRedirects` | — | Lists configured domain redirects for the authenticated client. |
| `POST /domain/modify-private-nameserver` | `ModifyPrivateNameserver` | `domain_id`, `nameserver` | Modifies a private/child nameserver. Provide at least one of new_nameserver or new_ip_address. Some registrars (COZA/COCCA) require new_ip_address and reject hostname changes. |
| `POST /domain/register-private-nameserver` | `RegisterPrivateNameserver` | `domain_id`, `ip_address`, `nameserver` | Registers a private/child nameserver (glue host) under an owned domain. Requires available_features.private_nameservers on get-domain. Distinct from update-nameservers. |
| `POST /domain/save-domain-required-data` | `SaveDomainRequiredData` | `domain_id`, `fields` | Saves additional registrar field values for a pending domain. Keys must match additionalFields[].name from list-domains-requiring-data. |
| `POST /domain/suggest` | `SuggestDomains` | `prompt` | Use for domain name ideas from a description. For specific domains, use check_domain_availability. |
| `POST /domain/update-domain-contacts` | `UpdateDomainContacts` | `contacts`, `domain_id` | Updates WHOIS contact information for an owned domain. Each role (Registrant, Admin, Tech, Billing) uses a source type: owner (client profile), contact (saved WHMCS contact id),… |
| `POST /domain/update-domain-settings` | `UpdateDomainSettings` | `domain_id`, `setting`, `value` | Updates a single domain setting (auto-renew, ID protection, or paid addons). One setting per request. |
| `POST /domain/update-lock-status` | `UpdateDomainLockStatus` | `domain_id`, `lock_status` | Sets the registrar transfer lock for an owned domain. When the account has 2FA enabled, upstream may return 403 until two_fa_code (or two_fa_backup) is supplied. |
| `POST /domain/update-nameservers` | `UpdateDomainNameservers` | `domain_id`, `ns1`, `ns2` | Updates nameservers for an owned domain. ns1 and ns2 are required; ns3 through ns5 are optional. |

## Firewall (5)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/create-firewall-rule` | `CreateFirewallRule` | `rule_action`, `service_id`, `type` | Creates a new firewall rule for a VPS service |
| `POST /vps/delete-firewall-rule` | `DeleteFirewallRule` | `pos`, `service_id` | Deletes a firewall rule from a VPS service |
| `POST /vps/list-firewall-rules` | `ListFirewallRules` | `service_id` | Retrieves the list of firewall rules and available options for a VPS service |
| `POST /vps/move-firewall-rule` | `MoveFirewallRule` | `pos`, `service_id` | Moves a firewall rule to a different position in the rule list. Supports both absolute positioning (target_pos) and relative movement (direction). Exactly one of target_pos or d… |
| `POST /vps/update-firewall-rule` | `UpdateFirewallRule` | `pos`, `service_id` | Updates an existing firewall rule for a VPS service |

## Monitoring (4)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/create-notification` | `CreateNotification` | `name`, `service_id` | Creates a new notification for a VPS service with customizable thresholds for CPU, memory, network, and disk metrics |
| `POST /vps/delete-notification` | `DeleteNotification` | `notification_id`, `service_id` | Deletes a notification from a VPS service |
| `POST /vps/list-notifications` | `ListNotifications` | `service_id` | Retrieves the list of notifications for a VPS service along with dialog rules for creating notifications |
| `POST /vps/update-notification` | `UpdateNotification` | `notification_id`, `service_id` | Updates an existing notification for a VPS service with customizable thresholds for CPU, memory, network, and disk metrics |

## Power Management (8)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/create-power-task` | `CreatePowerTask` | `power_task_action`, `service_id`, `start_date` | Creates a new power task (scheduled start/stop/restart operation) for a VPS service |
| `POST /vps/delete-power-task` | `DeletePowerTask` | `service_id`, `task_id` | Deletes a power task from a VPS service |
| `POST /vps/list-power-tasks` | `ListPowerTasks` | `service_id` | Retrieves the list of power tasks (scheduled start/stop/restart operations) for a VPS service |
| `POST /vps/reboot` | `RebootVps` | `service_id` | Gracefully reboot a VPS service. Sends ACPI reboot signal to guest OS |
| `POST /vps/shutdown` | `ShutdownVps` | `service_id` | Gracefully shutdown a VPS service. Sends ACPI shutdown signal to guest OS |
| `POST /vps/start` | `StartVps` | `service_id` | Starts a stopped VPS service |
| `POST /vps/stop` | `StopVps` | `service_id` | Hard stops a running VPS service |
| `POST /vps/update-power-task` | `UpdatePowerTask` | `service_id`, `task_id` | Updates an existing power task (scheduled start/stop/restart operation) for a VPS service |

## Service Management (6)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/cancel` | `CancelVps` | `service_id` | Cancels a VPS service. This action is irreversible |
| `POST /vps/create-order` | `CreateOrder` | `products` | Creates an order for a VPS service. Returns payment status; on failure also includes payment_error with code and message. |
| `POST /vps/get-catalogue` | `GetCatalogue` | — | Retrieves the product catalogue, optionally filtered by group or product |
| `POST /vps/list-orders` | `ListOrders` | — | Lists all orders for the authenticated user, including payment and invoice status |
| `POST /vps/retry-payment` | `RetryPayment` | `order_id`, `service_id` | Retries a failed or pending payment for an existing order |
| `POST /vps/validate-pricing` | `ValidatePricing` | `products` | Validates pricing for one or more VPC service products, returning per-product breakdown and order summary |

## Snapshots (9)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/create-snapshot` | `CreateSnapshot` | `name`, `service_id` | Creates a new snapshot for a VPS service |
| `POST /vps/create-snapshot-job` | `CreateSnapshotJob` | `name`, `period`, `service_id` | Creates a new snapshot job for a VPS service. Use period='hourly' with run_every, or period='daily' with days and start_time. |
| `POST /vps/delete-snapshot` | `DeleteSnapshot` | `service_id`, `snapshot_name` | Deletes a specific snapshot from a VPS service |
| `POST /vps/delete-snapshot-job` | `DeleteSnapshotJob` | `job_id`, `service_id` | Deletes a snapshot job from a VPS service |
| `POST /vps/list-snapshot-jobs` | `ListSnapshotJobs` | `service_id` | Retrieves the list of snapshot jobs for a VPS service |
| `POST /vps/list-snapshots` | `ListSnapshots` | `service_id` | Retrieves the list of snapshots for a VPS service |
| `POST /vps/rollback-snapshot` | `RollbackSnapshot` | `service_id`, `snapshot_name` | Rolls back a VPS to a previous snapshot state |
| `POST /vps/update-snapshot` | `UpdateSnapshot` | `service_id`, `snapshot_name` | Updates a snapshot's metadata |
| `POST /vps/update-snapshot-job` | `UpdateSnapshotJob` | `job_id`, `service_id` | Updates an existing snapshot job. Only provide fields you want to change. |

## VPS Management (9)

| Endpoint | operationId | Required body fields | What it does |
|---|---|---|---|
| `POST /vps/get-config` | `GetVpsConfig` | `service_id` | Retrieves VPS configuration settings including name, hostname, auto-start, boot order, and CD-ROM |
| `POST /vps/get-details` | `GetVpsDetails` | `service_id` | Gets detailed information about a VPS service including configuration, network settings, and statistics. Credentials.password is always "<redacted>"; plaintext passwords are nev… |
| `POST /vps/get-encrypted-password` | `GetEncryptedPassword` | `public_key`, `service_id` | Retrieves the VPS username and root password without exposing plaintext over the API. Send a PEM-encoded RSA 4096-bit public key; the API encrypts the password with RSA-OAEP (SH… |
| `POST /vps/list-isos` | `ListIsos` | `service_id` | Retrieves the list of available ISO images for a VPS service |
| `POST /vps/list-reinstall-images` | `ListReinstallOs` | `service_id` | Retrieves the list of available OS images for VPS reinstallation |
| `POST /vps/list-vps-services` | `ListVpsServices` | — | Lists all VPS services accessible by the authenticated user |
| `POST /vps/mount-iso` | `MountIso` | `iso`, `service_id` | Mounts an ISO image on a VPS service |
| `POST /vps/trigger-reinstall` | `TriggerReinstall` | `service_id`, `template` | Triggers a VPS reinstallation with the specified OS template |
| `POST /vps/update-config` | `UpdateVpsConfig` | `service_id` | Updates VPS configuration settings such as name, hostname, auto-start, boot order, and CD-ROM |
