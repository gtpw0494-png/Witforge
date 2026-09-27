"""Optional LangGraph adapter. The Node OneChat router remains the always-available fallback."""
def status():
    try:
        import langchain, langgraph
        return {"state":"CONNECTED","engine":"LangGraph","detail":"LangChain/LangGraph imports available."}
    except Exception as e:
        return {"state":"UNAVAILABLE","engine":"LangGraph","detail":str(e)}

if __name__ == "__main__":
    import json; print(json.dumps(status()))
