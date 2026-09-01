use serde::{Deserialize, Serialize};

pub const EPD_SERVICE_UUID: &str = "00001f10-0000-1000-8000-00805f9b34fb";
pub const EPD_CHAR_UUID: &str = "00001f1f-0000-1000-8000-00805f9b34fb";
pub const CTRL_SERVICE_UUID: &str = "7e400001-b5a3-f393-e0a9-e50e24dcca9e";
pub const CTRL_TX_CHAR_UUID: &str = "7e400002-b5a3-f393-e0a9-e50e24dcca9e";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleDeviceInfo {
    pub id: String,
    pub name: String,
    pub address: Option<String>,
    pub rssi: Option<i16>,
    pub service_uuids: Vec<String>,
    pub matched_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleGattCharacteristic {
    pub uuid: String,
    pub properties: Vec<String>,
    pub value_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleGattService {
    pub uuid: String,
    pub characteristics: Vec<BleGattCharacteristic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleGattDump {
    pub device_id: String,
    pub name: String,
    pub services: Vec<BleGattService>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleUploadProgress {
    pub total_bytes: usize,
    pub sent_bytes: usize,
    pub percent: u8,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BleUploadResult {
    pub success: bool,
    pub bytes_sent: usize,
    pub duration_ms: u64,
}

pub fn probe_matched_model(name: &str, service_uuids: &[String]) -> Option<String> {
    let lower_name = name.to_lowercase();
    if lower_name.contains("da14585")
        || lower_name.contains("pingping")
        || lower_name.starts_with("nrf-")
        || service_uuids.iter().any(|u| u.to_lowercase().contains("1f10"))
    {
        Some("PP_da14585_4.2".to_string())
    } else {
        None
    }
}

pub fn calculate_chunks(payload: &[u8], mtu: usize) -> Vec<Vec<u8>> {
    let chunk_size = (mtu.saturating_sub(3)).max(20);
    payload
        .chunks(chunk_size)
        .map(|chunk| chunk.to_vec())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_known_pingping_devices() {
        assert_eq!(
            probe_matched_model("NRF-1A2B3C", &[]),
            Some("PP_da14585_4.2".to_string())
        );
        assert_eq!(
            probe_matched_model("Unknown", &["00001f10-0000-1000-8000-00805f9b34fb".to_string()]),
            Some("PP_da14585_4.2".to_string())
        );
        assert_eq!(probe_matched_model("Other Device", &[]), None);
    }

    #[test]
    fn calculates_chunk_slices_correctly() {
        let payload = vec![0u8; 1000];
        let chunks = calculate_chunks(&payload, 247);
        assert_eq!(chunks.len(), 5); // 244 * 4 + 24 = 1000
        assert_eq!(chunks[0].len(), 244);
        assert_eq!(chunks[4].len(), 24);
    }
}
