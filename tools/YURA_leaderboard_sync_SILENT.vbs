Option Explicit

Const ForReading = 1

Dim fso, baseDir, tokenPath, jsonPath, logPath
Dim token, bytes, contentB64, sha, getUrl, putUrl, body
Dim http, statusCode

Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

tokenPath = fso.BuildPath(baseDir, "github_token.txt")
jsonPath = fso.BuildPath(baseDir, "leaderboard.json")
logPath = fso.BuildPath(baseDir, "leaderboard_sync.log")

On Error Resume Next

If Not fso.FileExists(tokenPath) Then
    WriteLog "ERROR: brak github_token.txt"
    WScript.Quit 1
End If

If Not fso.FileExists(jsonPath) Then
    WriteLog "ERROR: brak leaderboard.json"
    WScript.Quit 1
End If

token = Trim(ReadTextFile(tokenPath))
If Len(token) = 0 Then
    WriteLog "ERROR: github_token.txt jest pusty"
    WScript.Quit 1
End If

bytes = ReadBinaryFile(jsonPath)
contentB64 = Base64Encode(bytes)

getUrl = "https://api.github.com/repos/its-hei/YURA-Network/contents/leaderboard.json?ref=live-data"
putUrl = "https://api.github.com/repos/its-hei/YURA-Network/contents/leaderboard.json"

Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

' --- GET current SHA ---
http.Open "GET", getUrl, False
SetGitHubHeaders http, token
http.Send

statusCode = http.Status
sha = ""

If statusCode = 200 Then
    sha = ExtractSha(http.ResponseText)
ElseIf statusCode <> 404 Then
    WriteLog "ERROR GET: HTTP " & statusCode & " | " & http.ResponseText
    WScript.Quit 1
End If

' --- PUT new leaderboard.json ---
body = "{""message"":""data: sync Y.U.R.A. leaderboard"",""content"":""" & contentB64 & """,""branch"":""live-data"""
If Len(sha) > 0 Then
    body = body & ",""sha"":""" & sha & """"
End If
body = body & "}"

Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
http.Open "PUT", putUrl, False
SetGitHubHeaders http, token
http.SetRequestHeader "Content-Type", "application/json; charset=utf-8"
http.Send body

statusCode = http.Status

If statusCode = 200 Or statusCode = 201 Then
    WriteLog "OK: leaderboard synced | HTTP " & statusCode
    WScript.Quit 0
Else
    WriteLog "ERROR PUT: HTTP " & statusCode & " | " & http.ResponseText
    WScript.Quit 1
End If


Sub SetGitHubHeaders(req, authToken)
    req.SetRequestHeader "Accept", "application/vnd.github+json"
    req.SetRequestHeader "Authorization", "Bearer " & authToken
    req.SetRequestHeader "X-GitHub-Api-Version", "2022-11-28"
    req.SetRequestHeader "User-Agent", "YURA-Leaderboard-Sync"
End Sub


Function ExtractSha(jsonText)
    Dim re, matches
    Set re = New RegExp
    re.Pattern = """sha""\s*:\s*""([^""]+)"""
    re.IgnoreCase = True
    re.Global = False

    Set matches = re.Execute(jsonText)

    If matches.Count > 0 Then
        ExtractSha = matches(0).SubMatches(0)
    Else
        ExtractSha = ""
    End If
End Function


Function ReadTextFile(path)
    Dim ts
    Set ts = fso.OpenTextFile(path, ForReading, False)
    ReadTextFile = ts.ReadAll
    ts.Close
End Function


Function ReadBinaryFile(path)
    Dim stream
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.LoadFromFile path
    ReadBinaryFile = stream.Read
    stream.Close
End Function


Function Base64Encode(binaryData)
    Dim xmlDoc, node, value
    Set xmlDoc = CreateObject("Msxml2.DOMDocument.6.0")
    Set node = xmlDoc.createElement("base64")

    node.DataType = "bin.base64"
    node.nodeTypedValue = binaryData

    value = node.Text
    value = Replace(value, vbCr, "")
    value = Replace(value, vbLf, "")

    Base64Encode = value
End Function


Sub WriteLog(message)
    Dim ts
    Set ts = fso.OpenTextFile(logPath, 8, True)
    ts.WriteLine Now & " | " & message
    ts.Close
End Sub
