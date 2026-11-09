export class ProviderFailure extends Error {
  constructor(public kind: 'rejected' | 'ambiguous' | 'retryable', public publicCode: string) { super(publicCode); }
}
export interface SendResult { id: string; supplierCostMinor?: number; supplierCurrency?: string }
export interface SmsAdapter { send(input: { recipient: string; sender: string; body: string }): Promise<SendResult> }
export interface WhatsappAdapter {
  send(input: { phoneId: string; recipient: string; body?: string;
    template?: { name: string; language: string; variables: string[] }; messageId: string; token: string }): Promise<SendResult>;
}
