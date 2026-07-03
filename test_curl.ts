async function test() {
  try {
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{"role":"user","parts":[{"text":"Calculate the time with vorschub and everythibng..i want the real time ..werkzeug fraser bohrer usw"}]}] })
    });
    
    if (!response.ok) {
        console.error("HTTP error!", response.status);
        const err = await response.text();
        console.error("Error body:", err);
        return;
    }
    
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Fetch failed:", error);
  }
}
test();
