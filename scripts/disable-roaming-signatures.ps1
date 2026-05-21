<#
.SYNOPSIS
    Deaktiviert Outlook Roaming Signatures org-weit fuer einen M365-Tenant.

.DESCRIPTION
    Outlook synchronisiert Signaturen standardmaessig ueber die Exchange-Online-Cloud.
    Das bricht den M365 Signature Manager: lokal per SMB deployte Signatur-Files
    werden beim ersten Outlook-Start nach dem Deploy mit der alten Cloud-Version
    ueberschrieben (Race-Condition zwischen Login-Skript und Outlook-Sync).

    Dieses Skript setzt die Tenant-weite Option, die das Roaming abschaltet:
        Set-OrganizationConfig -PostponeRoamingSignaturesUntilLater $true

    Danach ist Roaming dauerhaft aus, kein Per-User-Registry-Workaround mehr noetig.
    Wirkt sofort nach naechstem Outlook-Neustart auf allen Clients.

.PARAMETER UserPrincipalName
    UPN des verbindenden Admin-Accounts (muss Global Admin oder Exchange Admin sein).

.PARAMETER WhatIf
    Zeigt nur an, was passieren wuerde — schreibt nicht.

.EXAMPLE
    .\disable-roaming-signatures.ps1 -UserPrincipalName admin@deinetenant.onmicrosoft.com

.EXAMPLE
    .\disable-roaming-signatures.ps1 -UserPrincipalName admin@deinetenant.onmicrosoft.com -WhatIf

.NOTES
    Benoetigt: ExchangeOnlineManagement-Modul (Powershell V3).
    Wird automatisch installiert wenn fehlt (CurrentUser-Scope).
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Admin-UPN, z.B. admin@deinetenant.onmicrosoft.com")]
    [string]$UserPrincipalName
)

$ErrorActionPreference = 'Stop'

Write-Host "M365 Signature Manager - Disable Roaming Signatures" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# 1) Exchange-Online-Modul sicherstellen
Write-Host "[1/5] Pruefe ExchangeOnlineManagement-Modul..."
$module = Get-Module -ListAvailable -Name ExchangeOnlineManagement | Sort-Object Version -Descending | Select-Object -First 1
if (-not $module) {
    Write-Host "       Nicht installiert - installiere fuer CurrentUser..." -ForegroundColor Yellow
    Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    $module = Get-Module -ListAvailable -Name ExchangeOnlineManagement | Sort-Object Version -Descending | Select-Object -First 1
}
Write-Host "       Version $($module.Version) verfuegbar." -ForegroundColor Green
Import-Module ExchangeOnlineManagement -DisableNameChecking

# 2) Verbinden
Write-Host ""
Write-Host "[2/5] Verbinde mit Exchange Online als $UserPrincipalName ..."
Connect-ExchangeOnline -UserPrincipalName $UserPrincipalName -ShowBanner:$false
Write-Host "       Verbunden." -ForegroundColor Green

try {
    # 3) Aktuellen Status anzeigen
    Write-Host ""
    Write-Host "[3/5] Aktueller Roaming-Status:"
    $before = Get-OrganizationConfig | Select-Object Identity, PostponeRoamingSignaturesUntilLater
    $before | Format-List
    if ($before.PostponeRoamingSignaturesUntilLater) {
        Write-Host "       Roaming Signatures ist bereits DEAKTIVIERT - nichts zu tun." -ForegroundColor Green
        return
    }

    # 4) Setting setzen
    Write-Host "[4/5] Setze PostponeRoamingSignaturesUntilLater = `$true ..."
    if ($PSCmdlet.ShouldProcess("OrganizationConfig", "Set PostponeRoamingSignaturesUntilLater = `$true")) {
        Set-OrganizationConfig -PostponeRoamingSignaturesUntilLater $true
        Write-Host "       Gesetzt." -ForegroundColor Green
    } else {
        Write-Host "       (WhatIf - nichts geschrieben)" -ForegroundColor Yellow
        return
    }

    # 5) Verifizieren
    Write-Host ""
    Write-Host "[5/5] Verifikation:"
    $after = Get-OrganizationConfig | Select-Object Identity, PostponeRoamingSignaturesUntilLater
    $after | Format-List
    if ($after.PostponeRoamingSignaturesUntilLater) {
        Write-Host "Fertig - Roaming Signatures ist tenant-weit deaktiviert." -ForegroundColor Green
        Write-Host "Greift sofort bei naechstem Outlook-Neustart auf allen Clients." -ForegroundColor Green
    } else {
        Write-Warning "Setting wurde gesetzt aber Get-OrganizationConfig zeigt es nicht. Cache? In paar Minuten nochmal pruefen."
    }
}
finally {
    Write-Host ""
    Write-Host "Trenne Verbindung..."
    Disconnect-ExchangeOnline -Confirm:$false
}
