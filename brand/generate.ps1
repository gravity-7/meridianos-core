$body = '{"contents":[{"parts":[{"text":"Generate a minimalist app icon: a perfect circle with a vertical meridian line through center, three glowing cyan nodes along the line, blue ring. Dark navy background. No text. Flat vector style."}]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"]}}'

try {
  $response = Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent" `
    -Method Post `
    -Headers @{ "x-goog-api-key" = $env:SKILL_IMAGE_GEN_GEMINI_KEY; "Content-Type" = "application/json" } `
    -Body $body

  $response | ConvertTo-Json -Depth 5 | Out-File "c:\projects\meridianos-core\brand\response.json"
  Write-Host "Response saved to brand/response.json"

  $part = $response.candidates[0].content.parts | Where-Object { $_.inlineData } | Select-Object -First 1
  if ($part) {
    $bytes = [Convert]::FromBase64String($part.inlineData.data)
    [IO.File]::WriteAllBytes("c:\projects\meridianos-core\brand\meridianos-logo-gemini.png", $bytes)
    Write-Host "Saved: brand/meridianos-logo-gemini.png ($($bytes.Length) bytes)"
  } else {
    Write-Host "No inlineData found in parts"
    Write-Host "Parts count: $($response.candidates[0].content.parts.Count)"
    $response.candidates[0].content.parts | ForEach-Object { Write-Host "Part keys: $($_.PSObject.Properties.Name -join ', ')" }
  }
} catch {
  Write-Host "ERROR: $_"
}
