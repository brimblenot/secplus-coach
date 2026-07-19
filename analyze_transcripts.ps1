# Comprehensive Transcript Gap Analysis
$transcriptDir = "c:\Users\samka\Desktop\secplus-v2\transcripts"
$csvOutput = @()

# Define key exam concepts by domain
$examConcepts = @{
    '1.1' = @('control', 'technical', 'managerial', 'operational', 'preventive', 'detective', 'corrective', 'deterrent', 'compensating')
    '1.2' = @('confidentiality', 'integrity', 'availability', 'non-repudiation', 'authentication', 'authorization', 'accounting')
    '1.3' = @('change management', 'change control', 'risk assessment', 'testing', 'rollback', 'approval')
    '1.4' = @('encryption', 'cryptography', 'hashing', 'digital signature', 'certificate', 'key exchange', 'pki', 'tls', 'ipsec', 'symmetric', 'asymmetric')
    '2.1' = @('threat actor', 'script kiddie', 'hacker', 'organized crime', 'nation state', 'insider', 'competitor')
    '2.2' = @('phishing', 'vishing', 'smishing', 'social engineering', 'pretexting', 'baiting', 'tailgating', 'impersonation')
    '2.3' = @('vulnerability', 'zero-day', 'buffer overflow', 'sql injection', 'xss', 'race condition')
    '2.4' = @('malware', 'virus', 'worm', 'trojan', 'ransomware', 'rootkit', 'keylogger', 'spyware', 'dos', 'ddos', 'botnet')
    '2.5' = @('segmentation', 'access control', 'firewall', 'ids', 'ips', 'mitigation', 'hardening')
    '3.1' = @('network', 'architecture', 'vlan', 'dmz', 'cloud', 'zero trust', 'infrastructure')
    '3.2' = @('firewall', 'ids', 'ips', 'proxy', 'vpn', 'tls', 'ipsec', 'protocol', 'intrusion')
    '3.3' = @('data classification', 'pii', 'encryption', 'masking', 'tokenization')
    '3.4' = @('backup', 'disaster recovery', 'business continuity', 'rto', 'rpo', 'failover', 'redundancy', 'resiliency')
    '4.1' = @('hardening', 'baseline', 'patch', 'update', 'security configuration')
    '4.2' = @('authentication', 'mfa', 'password', 'biometric', 'smart card', 'token', 'identity')
    '4.3' = @('vulnerability scan', 'penetration test', 'assessment', 'threat intelligence', 'analysis')
    '4.4' = @('siem', 'monitoring', 'logging', 'event correlation', 'real-time', 'log analysis')
    '4.5' = @('endpoint', 'antivirus', 'firewall', 'email security', 'web filter', 'dlp', 'operating system')
    '4.6' = @('iam', 'identity', 'access control', 'role', 'privilege', 'sso', 'mac', 'dac', 'rbac', 'abac')
    '4.7' = @('automation', 'scripting', 'api', 'orchestration')
    '4.8' = @('incident response', 'forensics', 'containment', 'eradication', 'recovery', 'detection')
    '4.9' = @('log', 'syslog', 'ntp', 'log retention')
    '5.1' = @('security policy', 'procedure', 'standard', 'responsibility', 'framework')
    '5.2' = @('risk management', 'risk assessment', 'risk analysis', 'risk response', 'mitigation')
    '5.3' = @('third party', 'vendor', 'sla', 'nda', 'contract')
    '5.4' = @('compliance', 'regulation', 'privacy', 'gdpr', 'hipaa', 'pci', 'framework')
    '5.5' = @('audit', 'assessment', 'penetration test')
    '5.6' = @('training', 'awareness', 'phishing simulation', 'security culture')
}

$domainNames = @{
    '1.1' = 'D1: Controls'; '1.2' = 'D1: CIA Triad'; '1.3' = 'D1: Change Mgmt'
    '1.4' = 'D1: Crypto'; '2.1' = 'D2: Threats'; '2.2' = 'D2: Vectors'
    '2.3' = 'D2: Vulns'; '2.4' = 'D2: Attacks'; '2.5' = 'D2: Mitigation'
    '3.1' = 'D3: Architecture'; '3.2' = 'D3: Network Sec'; '3.3' = 'D3: Data Sec'
    '3.4' = 'D3: Resilience'; '4.1' = 'D4: Hardening'; '4.2' = 'D4: Auth'
    '4.3' = 'D4: Vuln Mgmt'; '4.4' = 'D4: Monitoring'; '4.5' = 'D4: Tools'
    '4.6' = 'D4: IAM'; '4.7' = 'D4: Automation'; '4.8' = 'D4: IR'
    '4.9' = 'D4: Logging'; '5.1' = 'D5: Governance'; '5.2' = 'D5: Risk'
    '5.3' = 'D5: Vendor'; '5.4' = 'D5: Compliance'; '5.5' = 'D5: Assessments'
    '5.6' = 'D5: Training'
}

Get-ChildItem "$transcriptDir\*.txt" -File | Sort-Object Name | ForEach-Object {
    $fileName = $_.BaseName
    if ($fileName -match '^(\d{3})-(.+?)\s*-\s*CompTIA Security.*?-\s*(\d\.\d)') {
        $id = $matches[1]
        $title = $matches[2].Trim()
        $domain = $matches[3]
        
        $fileContent = Get-Content $_.FullName -TotalCount 50 -Raw -ErrorAction SilentlyContinue
        $contentLower = $fileContent.ToLower()
        
        $found = 0
        $missing = @()
        
        if ($examConcepts[$domain]) {
            foreach ($concept in $examConcepts[$domain]) {
                if ($contentLower -match [regex]::Escape($concept)) {
                    $found++
                } else {
                    $missing += $concept
                }
            }
        }
        
        $total = $examConcepts[$domain].Count
        $coverage = [math]::Round(($found / $total) * 100, 0)
        
        $depth = if ($coverage -ge 80) { 'Comprehensive' } 
                 elseif ($coverage -ge 60) { 'Adequate' }
                 elseif ($coverage -ge 40) { 'Insufficient' }
                 else { 'Critical Gap' }
        
        $recommendation = switch ($depth) {
            'Comprehensive' { 'Do Not Change' }
            'Adequate' { 'Minor Enhancement' }
            'Insufficient' { 'Major Enhancement' }
            'Critical Gap' { 'Complete Rewrite' }
        }
        
        $csvOutput += [PSCustomObject]@{
            ID = $id
            Title = $title
            Domain = $domainNames[$domain]
            Coverage = $coverage
            Depth = $depth
            MissingContent = ($missing -join '; ')
            Recommendation = $recommendation
        }
    }
}

$csvPath = "c:\Users\samka\Desktop\secplus-v2\transcript_gap_analysis.csv"
$csvOutput | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8

Write-Host "✓ Analysis complete: $($csvOutput.Count) transcripts analyzed"
Write-Host "✓ Output saved to: $csvPath`n"

$byDepth = $csvOutput | Group-Object -Property Depth | Sort-Object Name -Descending
Write-Host "=== COVERAGE DISTRIBUTION ===" -ForegroundColor Green
foreach ($group in $byDepth) {
    Write-Host "$($group.Name): $($group.Count)"
}

Write-Host "`n=== CRITICAL GAPS (Top 20 Requiring Enhancement) ===" -ForegroundColor Yellow
$critical = $csvOutput | Where-Object { $_.Depth -in 'Insufficient', 'Critical Gap' } | Sort-Object Coverage
$critical | Select-Object -First 20 | ForEach-Object {
    Write-Host "[$($_.ID)] $($_.Title) - Coverage: $($_.Coverage)% - $($_.Recommendation)"
}
