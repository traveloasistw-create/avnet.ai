' ============================================
'  Camera Wall - open the dashboard at startup
' ============================================
'  Waits for the background service to be ready,
'  then opens the camera dashboard in the browser.
'  Prefers Chrome, then Edge, then the default browser.

Option Explicit

Dim sh, fso, url, browsers, exe, i, waited

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

url = "http://localhost:8080"

' --- Give the background service time to boot (max ~90 seconds) ---
waited = 0
Do While waited < 90
  WScript.Sleep 5000
  waited = waited + 5
  If ServiceIsUp() Then Exit Do
Loop

' --- Find a browser ---
browsers = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") )

exe = ""
For i = 0 To UBound(browsers)
  If exe = "" Then
    If fso.FileExists(browsers(i)) Then exe = browsers(i)
  End If
Next

If exe = "" Then
  ' No Chrome or Edge found - use whatever the default browser is
  sh.Run url, 1, False
Else
  ' 3 = maximized window
  sh.Run """" & exe & """ --new-window --start-maximized " & url, 3, False
End If


' Returns True once the dashboard answers on localhost:8080
Function ServiceIsUp()
  Dim http
  ServiceIsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", url & "/login.html", False
  http.Send
  If Err.Number = 0 Then
    If http.Status > 0 Then ServiceIsUp = True
  End If
  On Error GoTo 0
End Function
