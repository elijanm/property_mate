export interface TrainerSubmission {
  id: string;
  org_id: string;
  owner_email: string;
  trainer_name: string;
  namespace: string;
  file_key: string;
  submission_hash: string;
  status: 'scanning' | 'pending_admin' | 'approved' | 'flagged' | 'rejected';
  llm_scan_result: {
    passed?: boolean;
    severity?: string;
    summary?: string;
    issues?: string[];
    quick_hits?: string[];
    model_used?: string;
  };
  llm_model_used: string;
  admin_ticket_id?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  approved_at?: string;
  rejection_reason?: string;
  parsed_metadata: Record<string, string>;
  submitted_at: string;
  updated_at: string;
}

export interface AdminTicket {
  id: string;
  category: string;
  title: string;
  body: string;
  related_id: string;
  org_id: string;
  owner_email: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  assigned_to?: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface TrainerViolation {
  id: string;
  org_id: string;
  owner_email: string;
  submission_id: string;
  trainer_name: string;
  severity: 'low' | 'high' | 'critical' | 'malicious';
  summary: string;
  issues: string[];
  admin_note: string;
  resolved: boolean;
  created_at: string;
}

export interface MLClient {
  org_id: string;
  org_name?: string;
  user_count: number;
  trainer_count: number;
  deployment_count: number;
  violation_count: number;
  plan_name?: string;
  last_active?: string;
}
