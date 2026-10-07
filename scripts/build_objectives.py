#!/usr/bin/env python3
"""Build content/objectives.json - the SY0-701 taxonomy backbone.

Source of truth: reference/sy0-701-objectives-official.pdf (CompTIA Exam
Objectives v5.0). Topic labels below are transcribed from that document so
every bank item can be tagged to a real objective + sub-topic, which is what
makes coverage tracking and exam-weighted retargeting possible.
"""
import json, re, pathlib

EXAM = {
    "code": "SY0-701",
    "name": "CompTIA Security+",
    "objectivesVersion": "5.0",
    "maxQuestions": 90,
    "minutes": 90,
    "scaleMin": 100,
    "scaleMax": 900,
    "passScaled": 750,
    "pbqCountRange": [1, 10],
    "pbqCountTypical": [4, 5],
    "pbqPlacement": "front-loaded",
    "questionTypes": ["multiple-choice", "performance-based"],
}

DOMAINS = [
    ("1", "General Security Concepts", 0.12),
    ("2", "Threats, Vulnerabilities, and Mitigations", 0.22),
    ("3", "Security Architecture", 0.18),
    ("4", "Security Operations", 0.28),
    ("5", "Security Program Management and Oversight", 0.20),
]

# objective id -> (verb/stem, title, [topic labels])
OBJ = {
"1.1": ("Compare and contrast", "various types of security controls", [
    "Technical controls", "Managerial controls", "Operational controls", "Physical controls",
    "Preventive", "Deterrent", "Detective", "Corrective", "Compensating", "Directive"]),
"1.2": ("Summarize", "fundamental security concepts", [
    "Confidentiality", "Integrity", "Availability", "Non-repudiation",
    "Authentication, Authorization, and Accounting (AAA)", "Authenticating people",
    "Authenticating systems", "Authorization models", "Gap analysis", "Zero Trust",
    "Control plane", "Adaptive identity", "Threat scope reduction",
    "Policy-driven access control", "Policy Administrator", "Policy Engine",
    "Data plane", "Implicit trust zones", "Subject/System", "Policy Enforcement Point",
    "Bollards", "Access control vestibule", "Fencing", "Video surveillance",
    "Security guard", "Access badge", "Lighting", "Infrared sensor", "Pressure sensor",
    "Microwave sensor", "Ultrasonic sensor", "Honeypot", "Honeynet", "Honeyfile", "Honeytoken"]),
"1.3": ("Explain", "the importance of change management processes and the impact to security", [
    "Approval process", "Ownership", "Stakeholders", "Impact analysis", "Test results",
    "Backout plan", "Maintenance window", "Standard operating procedure",
    "Allow lists/deny lists", "Restricted activities", "Downtime", "Service restart",
    "Application restart", "Legacy applications", "Dependencies", "Updating diagrams",
    "Updating policies/procedures", "Version control"]),
"1.4": ("Explain", "the importance of using appropriate cryptographic solutions", [
    "Public key infrastructure (PKI)", "Public key", "Private key", "Key escrow",
    "Full-disk encryption", "Partition encryption", "File encryption", "Volume encryption",
    "Database encryption", "Record encryption", "Transport/communication encryption",
    "Asymmetric encryption", "Symmetric encryption", "Key exchange", "Algorithms",
    "Key length", "Trusted Platform Module (TPM)", "Hardware security module (HSM)",
    "Key management system", "Secure enclave", "Steganography", "Tokenization",
    "Data masking", "Hashing", "Salting", "Digital signatures", "Key stretching",
    "Blockchain", "Open public ledger", "Certificate authorities",
    "Certificate revocation lists (CRLs)", "Online Certificate Status Protocol (OCSP)",
    "Self-signed certificates", "Third-party certificates", "Root of trust",
    "Certificate signing request (CSR) generation", "Wildcard certificates"]),

"2.1": ("Compare and contrast", "common threat actors and motivations", [
    "Nation-state", "Unskilled attacker", "Hacktivist", "Insider threat", "Organized crime",
    "Shadow IT", "Internal/external", "Resources/funding", "Level of sophistication/capability",
    "Data exfiltration", "Espionage", "Service disruption", "Blackmail", "Financial gain",
    "Philosophical/political beliefs", "Ethical", "Revenge", "Disruption/chaos", "War"]),
"2.2": ("Explain", "common threat vectors and attack surfaces", [
    "Email", "Short Message Service (SMS)", "Instant messaging (IM)", "Image-based",
    "File-based", "Voice call", "Removable device", "Vulnerable software",
    "Client-based vs. agentless", "Unsupported systems and applications",
    "Unsecure wireless networks", "Unsecure wired networks", "Bluetooth",
    "Open service ports", "Default credentials", "Managed service providers (MSPs)",
    "Vendors", "Suppliers", "Phishing", "Vishing", "Smishing",
    "Misinformation/disinformation", "Impersonation", "Business email compromise",
    "Pretexting", "Watering hole", "Brand impersonation", "Typosquatting"]),
"2.3": ("Explain", "various types of vulnerabilities", [
    "Memory injection", "Buffer overflow", "Race conditions", "Time-of-check (TOC)",
    "Time-of-use (TOU)", "Malicious update", "Operating system (OS)-based",
    "SQL injection (SQLi)", "Cross-site scripting (XSS)", "Firmware", "End-of-life",
    "Legacy hardware", "Virtual machine (VM) escape", "Resource reuse", "Cloud-specific",
    "Service provider supply chain", "Hardware provider supply chain",
    "Software provider supply chain", "Cryptographic vulnerabilities", "Misconfiguration",
    "Mobile device vulnerabilities", "Side loading", "Jailbreaking", "Zero-day"]),
"2.4": ("Given a scenario, analyze", "indicators of malicious activity", [
    "Ransomware", "Trojan", "Worm", "Spyware", "Bloatware", "Virus", "Keylogger",
    "Logic bomb", "Rootkit", "Physical brute force", "RFID cloning", "Environmental attacks",
    "Distributed denial-of-service (DDoS)", "Amplified DDoS", "Reflected DDoS",
    "DNS attacks", "Wireless attacks", "On-path", "Credential replay", "Malicious code",
    "Injection", "Application buffer overflow", "Replay", "Privilege escalation", "Forgery",
    "Directory traversal", "Downgrade attack", "Collision", "Birthday attack",
    "Password spraying", "Password brute force", "Indicators", "Account lockout",
    "Concurrent session usage", "Blocked content", "Impossible travel",
    "Resource consumption", "Resource inaccessibility", "Out-of-cycle logging",
    "Published/documented indicators", "Missing logs"]),
"2.5": ("Explain", "the purpose of mitigation techniques used to secure the enterprise", [
    "Segmentation", "Access control list (ACL)", "Permissions", "Application allow list",
    "Isolation", "Patching", "Encryption", "Monitoring", "Least privilege",
    "Configuration enforcement", "Decommissioning", "Endpoint protection installation",
    "Host-based firewall", "Host-based intrusion prevention system (HIPS)",
    "Disabling ports/protocols", "Default password changes",
    "Removal of unnecessary software"]),

"3.1": ("Compare and contrast", "security implications of different architecture models", [
    "Cloud responsibility matrix", "Hybrid considerations", "Third-party vendors",
    "Infrastructure as code (IaC)", "Serverless", "Microservices", "Physical isolation",
    "Air-gapped", "Logical segmentation", "Software-defined networking (SDN)",
    "On-premises", "Centralized vs. decentralized", "Containerization", "Virtualization",
    "IoT", "ICS/SCADA", "Real-time operating system (RTOS)", "Embedded systems",
    "High availability", "Availability", "Resilience", "Cost", "Responsiveness",
    "Scalability", "Ease of deployment", "Risk transference", "Ease of recovery",
    "Patch availability", "Inability to patch", "Power", "Compute"]),
"3.2": ("Given a scenario, apply", "security principles to secure enterprise infrastructure", [
    "Device placement", "Security zones", "Attack surface", "Connectivity", "Fail-open",
    "Fail-closed", "Active vs. passive", "Inline vs. tap/monitor", "Jump server",
    "Proxy server", "Intrusion prevention system (IPS)",
    "Intrusion detection system (IDS)", "Load balancer", "Sensors", "802.1X",
    "Extensible Authentication Protocol (EAP)", "Web application firewall (WAF)",
    "Firewall types", "Unified threat management (UTM)", "Next-generation firewall (NGFW)",
    "Layer 4/Layer 7 firewall", "Virtual private network (VPN)", "Remote access",
    "TLS tunneling", "IPSec tunneling", "Software-defined wide area network (SD-WAN)",
    "Secure access service edge (SASE)", "Selection of effective controls"]),
"3.3": ("Compare and contrast", "concepts and strategies to protect data", [
    "Regulated data", "Trade secret", "Intellectual property", "Legal information",
    "Financial information", "Human- and non-human-readable", "Sensitive", "Confidential",
    "Public", "Restricted", "Private", "Critical", "Data at rest", "Data in transit",
    "Data in use", "Data sovereignty", "Geolocation", "Geographic restrictions",
    "Encryption", "Hashing", "Masking", "Tokenization", "Obfuscation", "Segmentation",
    "Permission restrictions"]),
"3.4": ("Explain", "the importance of resilience and recovery in security architecture", [
    "High availability", "Load balancing vs. clustering", "Hot site", "Cold site",
    "Warm site", "Geographic dispersion", "Platform diversity", "Multi-cloud systems",
    "Continuity of operations", "Capacity planning - people", "Capacity planning - technology",
    "Capacity planning - infrastructure", "Tabletop exercises", "Fail over", "Simulation",
    "Parallel processing", "Onsite/offsite backups", "Backup frequency",
    "Backup encryption", "Snapshots", "Recovery", "Replication", "Journaling",
    "Generators", "Uninterruptible power supply (UPS)"]),

"4.1": ("Given a scenario, apply", "common security techniques to computing resources", [
    "Establish secure baselines", "Deploy secure baselines", "Maintain secure baselines",
    "Harden mobile devices", "Harden workstations", "Harden switches", "Harden routers",
    "Harden cloud infrastructure", "Harden servers", "Harden ICS/SCADA",
    "Harden embedded systems", "Harden RTOS", "Harden IoT devices", "Site surveys",
    "Heat maps", "Mobile device management (MDM)", "Bring your own device (BYOD)",
    "Corporate-owned, personally enabled (COPE)", "Choose your own device (CYOD)",
    "Cellular", "Wi-Fi", "Bluetooth", "Wi-Fi Protected Access 3 (WPA3)",
    "AAA/RADIUS", "Cryptographic protocols", "Authentication protocols",
    "Input validation", "Secure cookies", "Static code analysis", "Code signing",
    "Sandboxing", "Monitoring"]),
"4.2": ("Explain", "the security implications of proper hardware, software, and data asset management", [
    "Acquisition/procurement process", "Ownership", "Classification",
    "Monitoring/asset tracking", "Inventory", "Enumeration", "Disposal/decommissioning", "Sanitization",
    "Destruction", "Certification", "Data retention"]),
"4.3": ("Explain", "various activities associated with vulnerability management", [
    "Vulnerability scan", "Static analysis", "Dynamic analysis", "Package monitoring",
    "Open-source intelligence (OSINT)", "Proprietary/third-party threat feed",
    "Information-sharing organization", "Dark web", "Penetration testing",
    "Responsible disclosure program", "Bug bounty program", "System/process audit",
    "False positive", "False negative", "Prioritize",
    "Common Vulnerability Scoring System (CVSS)",
    "Common Vulnerability Enumeration (CVE)", "Vulnerability classification",
    "Exposure factor", "Environmental variables", "Industry/organizational impact",
    "Risk tolerance", "Patching", "Insurance", "Segmentation", "Compensating controls",
    "Exceptions and exemptions", "Rescanning", "Audit", "Verification", "Reporting"]),
"4.4": ("Explain", "security alerting and monitoring concepts and tools", [
    "Monitoring systems", "Monitoring applications", "Monitoring infrastructure",
    "Log aggregation", "Alerting", "Scanning", "Reporting", "Archiving",
    "Alert response and remediation/validation", "Quarantine", "Alert tuning",
    "Security Content Automation Protocol (SCAP)", "Benchmarks", "Agents/agentless",
    "Security information and event management (SIEM)", "Antivirus",
    "Data loss prevention (DLP)", "SNMP traps", "NetFlow", "Vulnerability scanners"]),
"4.5": ("Given a scenario, modify", "enterprise capabilities to enhance security", [
    "Firewall rules", "Access lists", "Ports/protocols", "Screened subnets",
    "IDS/IPS trends", "IDS/IPS signatures", "Agent-based web filter",
    "Centralized proxy", "URL scanning", "Content categorization", "Block rules",
    "Reputation", "Group Policy", "SELinux", "Protocol selection", "Port selection",
    "Transport method", "DNS filtering",
    "Domain-based Message Authentication Reporting and Conformance (DMARC)",
    "DomainKeys Identified Mail (DKIM)", "Sender Policy Framework (SPF)",
    "Email gateway", "File integrity monitoring", "DLP",
    "Network access control (NAC)", "Endpoint detection and response (EDR)",
    "Extended detection and response (XDR)", "User behavior analytics"]),
"4.6": ("Given a scenario, implement and maintain", "identity and access management", [
    "Provisioning user accounts", "De-provisioning user accounts",
    "Permission assignments and implications", "Identity proofing", "Federation",
    "Single sign-on (SSO)", "Lightweight Directory Access Protocol (LDAP)",
    "Open authorization (OAuth)", "Security Assertions Markup Language (SAML)",
    "Interoperability", "Attestation", "Mandatory access control (MAC)",
    "Discretionary access control (DAC)", "Role-based access control (RBAC)",
    "Rule-based access control", "Attribute-based access control (ABAC)",
    "Time-of-day restrictions", "Least privilege", "Multifactor authentication", "Biometrics",
    "Hard/soft authentication tokens", "Security keys", "Something you know",
    "Something you have", "Something you are", "Somewhere you are", "Password length",
    "Password complexity", "Password reuse", "Password expiration", "Password age",
    "Password managers", "Passwordless", "Just-in-time permissions",
    "Password vaulting", "Ephemeral credentials",
    "Privileged access management (PAM) tools"]),
"4.7": ("Explain", "the importance of automation and orchestration related to secure operations", [
    "User provisioning", "Resource provisioning", "Guard rails", "Security groups",
    "Ticket creation", "Escalation", "Enabling/disabling services and access",
    "Continuous integration and testing", "Integrations and APIs",
    "Efficiency/time saving", "Enforcing baselines",
    "Standard infrastructure configurations", "Scaling in a secure manner",
    "Employee retention", "Reaction time", "Workforce multiplier", "Complexity", "Cost",
    "Single point of failure", "Technical debt", "Ongoing supportability"]),
"4.8": ("Explain", "appropriate incident response activities", [
    "Preparation", "Detection", "Analysis", "Containment", "Eradication", "Recovery",
    "Lessons learned", "Training", "Tabletop exercise", "Simulation",
    "Root cause analysis", "Threat hunting", "Legal hold", "Chain of custody",
    "Acquisition", "Reporting", "Preservation", "E-discovery"]),
"4.9": ("Given a scenario, use", "data sources to support an investigation", [
    "Firewall logs", "Application logs", "Endpoint logs", "OS-specific security logs",
    "IPS/IDS logs", "Network logs", "Metadata", "Vulnerability scans",
    "Automated reports", "Dashboards", "Packet captures"]),

"5.1": ("Summarize", "elements of effective security governance", [
    "Guidelines", "Acceptable use policy (AUP)", "Information security policies",
    "Business continuity policy", "Disaster recovery policy", "Incident response policy",
    "Software development lifecycle (SDLC) policy", "Change management policy",
    "Password standards", "Access control standards", "Physical security standards",
    "Encryption standards", "Change management procedures", "Onboarding/offboarding",
    "Playbooks", "Regulatory considerations", "Legal considerations",
    "Industry considerations", "Local/regional considerations", "National considerations",
    "Global considerations", "Monitoring and revision", "Boards", "Committees",
    "Government entities", "Centralized/decentralized governance", "Owners",
    "Controllers", "Processors", "Custodians/stewards"]),
"5.2": ("Explain", "elements of the risk management process", [
    "Risk identification", "Risk assessment", "Ad hoc assessment", "Recurring assessment",
    "One-time assessment", "Continuous assessment", "Qualitative risk analysis",
    "Quantitative risk analysis", "Single loss expectancy (SLE)",
    "Annualized loss expectancy (ALE)", "Annualized rate of occurrence (ARO)",
    "Probability", "Likelihood", "Exposure factor", "Impact", "Risk register",
    "Key risk indicators", "Risk owners", "Risk threshold", "Risk tolerance", "Risk appetite",
    "Expansionary risk appetite", "Conservative risk appetite", "Neutral risk appetite",
    "Transfer", "Accept", "Exemption", "Exception", "Avoid", "Mitigate", "Risk reporting",
    "Business impact analysis", "Recovery time objective (RTO)",
    "Recovery point objective (RPO)", "Mean time to repair (MTTR)",
    "Mean time between failures (MTBF)"]),
"5.3": ("Explain", "the processes associated with third-party risk assessment and management", [
    "Vendor penetration testing", "Right-to-audit clause", "Evidence of internal audits",
    "Independent assessments", "Supply chain analysis", "Due diligence",
    "Conflict of interest", "Service-level agreement (SLA)",
    "Memorandum of agreement (MOA)", "Memorandum of understanding (MOU)",
    "Master service agreement (MSA)", "Work order (WO)/statement of work (SOW)",
    "Non-disclosure agreement (NDA)", "Business partners agreement (BPA)",
    "Vendor monitoring", "Questionnaires", "Rules of engagement"]),
"5.4": ("Summarize", "elements of effective security compliance", [
    "Internal compliance reporting", "External compliance reporting", "Fines", "Sanctions",
    "Reputational damage", "Loss of license", "Contractual impacts",
    "Due diligence/care", "Attestation and acknowledgement",
    "Internal and external monitoring", "Automation", "Local/regional privacy law",
    "National privacy law", "Global privacy law", "Data subject",
    "Controller vs. processor", "Ownership", "Data inventory and retention",
    "Right to be forgotten"]),
"5.5": ("Explain", "types and purposes of audits and assessments", [
    "Attestation", "Internal compliance audit", "Audit committee", "Self-assessments",
    "Regulatory examination", "External assessment", "Independent third-party audit",
    "Physical penetration testing", "Offensive", "Defensive", "Integrated",
    "Known environment", "Partially known environment", "Unknown environment",
    "Passive reconnaissance", "Active reconnaissance"]),
"5.6": ("Given a scenario, implement", "security awareness practices", [
    "Phishing campaigns", "Recognizing a phishing attempt",
    "Responding to reported suspicious messages", "Risky behavior",
    "Unexpected behavior", "Unintentional behavior", "User guidance and training", "Policy/handbooks",
    "Situational awareness", "Insider threat awareness", "Password management",
    "Removable media and cables", "Social engineering awareness",
    "Operational security", "Hybrid/remote work environments", "Initial reporting",
    "Recurring reporting", "Development", "Execution"]),
}


def _slugify(text: str) -> str:
    text = text.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def slug(text: str) -> str:
    """Primary id: the label with parenthetical expansions dropped."""
    return _slugify(re.sub(r"\([^)]*\)", " ", text))


def aliases(text: str, primary: str) -> list:
    """Also accept the acronym-inclusive form, so both
    'single-loss-expectancy' and 'single-loss-expectancy-sle' resolve."""
    out = {_slugify(text)}
    out.discard(primary)
    return sorted(out)


def build():
    seen, domains = {}, []
    for did, dtitle, weight in DOMAINS:
        objectives = []
        for oid, (verb, title, topics) in OBJ.items():
            if not oid.startswith(did + "."):
                continue
            tlist = []
            for label in topics:
                s = slug(label)
                base, n = s, 2
                while s in seen and seen[s] != (oid, label):
                    s = f"{base}-{n}"; n += 1
                seen[s] = (oid, label)
                entry = {"id": s, "label": label}
                al = aliases(label, s)
                if al:
                    entry["aliases"] = al
                tlist.append(entry)
            objectives.append({
                "id": oid,
                "stem": verb,
                "title": title,
                "fullTitle": f"{verb} {title}.",
                "topics": tlist,
            })
        objectives.sort(key=lambda o: [int(p) for p in o["id"].split(".")])
        domains.append({"id": did, "title": dtitle, "weight": weight,
                        "objectives": objectives})

    total = sum(len(t["topics"]) for d in domains for t in d["objectives"])
    doc = {
        "$schema": "./schemas/objectives.schema.json",
        "exam": EXAM,
        "source": "CompTIA Security+ SY0-701 Exam Objectives v5.0 (official, public PDF)",
        "counts": {
            "domains": len(domains),
            "objectives": sum(len(d["objectives"]) for d in domains),
            "topics": total,
        },
        "domains": domains,
    }
    out = pathlib.Path(__file__).resolve().parent.parent / "content" / "objectives.json"
    out.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"wrote {out}")
    print(f"  domains={len(domains)} objectives={doc['counts']['objectives']} topics={total}")
    for d in domains:
        print(f"  {d['id']}.0 {d['title']:<45} {d['weight']:.0%}  "
              f"{len(d['objectives'])} obj, "
              f"{sum(len(o['topics']) for o in d['objectives'])} topics")


if __name__ == "__main__":
    build()
