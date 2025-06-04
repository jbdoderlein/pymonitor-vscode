# PyMonitor API Documentation

This document contains documentation for the PyMonitor API endpoints provided by the `api.py` module.

## Base URL

The API is hosted at the server root, with all endpoints prefixed with `/api/`.

## Authentication

Currently, the API does not require authentication.

## Endpoints

### Database Information

#### `GET /api/db-info`

Returns information about the connected database.

**Response:**

```json
{
  "db_path": "/path/to/database.db"
}
```

### Function Calls

#### `GET /api/function-calls`

Returns a list of function calls with optional filtering.

**Query Parameters:**

- `search`: (Optional) A search term to filter function calls by function name or file path
- `file`: (Optional) Filter by file path
- `function`: (Optional) Filter by function name

**Response:**

```json
{
  "function_calls": [
    {
      "id": "function_call_id",
      "function": "function_name",
      "file": "file_path",
      "line": 42,
      "start_time": "2023-07-21T12:34:56.123456",
      "end_time": "2023-07-21T12:34:57.123456",
      "duration": 1.0,
      "has_stack_recording": true,
      "locals": {...},
      "globals": {...},
      "return_value": {...}
    },
    ...
  ]
}
```

#### `GET /api/function-call/{call_id}`

Returns detailed information about a specific function call.

**Path Parameters:**

- `call_id`: The ID of the function call to retrieve

**Response:**

```json
{
  "function_call": {
    "id": "function_call_id",
    "function": "function_name",
    "file": "file_path",
    "line": 42,
    "start_time": "2023-07-21T12:34:56.123456",
    "end_time": "2023-07-21T12:34:57.123456",
    "duration": 1.0,
    "has_stack_recording": true,
    "locals": {...},
    "globals": {...},
    "return_value": {...},
    "stack_trace": [...]
  }
}
```

### Stack Recordings

#### `GET /api/stack-recording/{function_id}`

Returns stack snapshot information for a function call.

**Path Parameters:**

- `function_id`: The ID of the function call to retrieve stack recordings for

**Response:**

```json
{
  "function": {
    "id": "function_id",
    "name": "function_name",
    "file": "file_path",
    "line": 42,
    "time": "2023-07-21T12:34:56.123456",
    "end_time": "2023-07-21T12:34:57.123456",
    "code_definition_id": "code_def_id",
    "call_metadata": {...}
  },
  "frames": [
    {
      "id": "snapshot_id",
      "line": 43,
      "snapshot_id": "snapshot_id",
      "timestamp": "2023-07-21T12:34:56.223456",
      "locals_refs": {...},
      "globals_refs": {...},
      "locals": {...},
      "globals": {...}
    },
    ...
  ]
}
```

#### `GET /api/snapshot/{snapshot_id}`

Returns detailed information about a specific stack snapshot.

**Path Parameters:**

- `snapshot_id`: The ID of the stack snapshot to retrieve

**Response:**

```json
{
  "id": "snapshot_id",
  "function_call_id": "function_call_id",
  "function": "function_name",
  "file": "file_path",
  "line": 43,
  "timestamp": "2023-07-21T12:34:56.223456",
  "locals": {...},
  "globals": {...},
  "previous_snapshot_id": "previous_snapshot_id",
  "next_snapshot_id": "next_snapshot_id"
}
```

### Object Graph

#### `GET /api/object-graph`

Returns the object graph for visualization.

**Query Parameters:**

- `show_isolated`: (Optional) Whether to include isolated object nodes with no connections (default: false)

**Response:**

```json
{
  "nodes": [
    {
      "data": {
        "id": "node_id",
        "originalId": "original_id",
        "label": "node_label",
        "nodeType": "function|code|object",
        "type": "node_type",
        "... other node properties ..."
      }
    },
    ...
  ],
  "edges": [
    {
      "data": {
        "id": "edge_id",
        "source": "source_node_id",
        "target": "target_node_id",
        "label": "edge_label",
        "edgeType": "edge_type"
      }
    },
    ...
  ]
}
```

### Monitoring Sessions

#### `GET /api/sessions`

Returns a list of all monitoring sessions.

**Response:**

```json
{
  "sessions": [
    {
      "id": 1,
      "name": "session_name",
      "description": "session_description",
      "start_time": "2023-07-21T12:34:56.123456",
      "end_time": "2023-07-21T12:34:57.123456",
      "function_calls": ["function_call_id_1", "function_call_id_2", ...],
      "function_count": {"function_name": 2, ...},
      "metadata": {...}
    },
    ...
  ]
}
```

#### `GET /api/session/{session_id}`

Returns detailed information about a specific monitoring session.

**Path Parameters:**

- `session_id`: The ID of the monitoring session to retrieve

**Response:**

```json
{
  "id": 1,
  "name": "session_name",
  "description": "session_description",
  "start_time": "2023-07-21T12:34:56.123456",
  "end_time": "2023-07-21T12:34:57.123456",
  "function_calls": ["function_call_id_1", "function_call_id_2", ...],
  "function_calls_map": {
    "function_name_1": ["function_call_id_1", ...],
    "function_name_2": ["function_call_id_2", ...]
  },
  "function_count": {"function_name_1": 1, "function_name_2": 1, ...},
  "metadata": {...},
  "common_variables": {
    "function_name_1": {
      "locals": ["var1", "var2", ...],
      "globals": ["var3", "var4", ...]
    },
    ...
  }
}
```

## Error Responses

The API will return appropriate HTTP status codes along with error messages:

- **400**: Bad Request - Invalid parameters
- **404**: Not Found - Resource not found
- **500**: Internal Server Error - Server-side error

Error responses have the following format:

```json
{
  "detail": "Error message"
}
```

## Data Types

### StoredValue

The `serialize_stored_value` function returns objects with this structure:

```json
{
  "value": "string representation of the value",
  "type": "type name (e.g., int, str, list, etc.)"
}
```

### FunctionCallInfo

The `serialize_call_info` function returns objects with this structure:

```json
{
  "id": "function_call_id",
  "function": "function_name",
  "file": "file_path",
  "line": 42,
  "... other properties ...",
  "locals": {
    "variable_name": {
      "value": "serialized value",
      "type": "type name"
    },
    ...
  },
  "globals": {
    "variable_name": {
      "value": "serialized value",
      "type": "type name"
    },
    ...
  },
  "return_value": {
    "value": "serialized return value",
    "type": "return type"
  }
}
``` 