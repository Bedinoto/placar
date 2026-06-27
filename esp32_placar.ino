/*
 * Padel & Beach Tennis Scoreboard ESP32 Controller with RF 433MHz Support
 * Author: AI Coding Assistant (Google AI Studio)
 * 
 * Este código controla o placar de Padel e Beach Tennis integrado com o sistema web.
 * Ele aceita comandos tanto de botões físicos (Pullup) quanto de módulos receptores RF 433 MHz.
 * Ideal para usar com 2 controles remotos de 3 botões (um para cada time)!
 * 
 * Requisitos:
 * 1. Instale a biblioteca "rc-switch" no Gerenciador de Bibliotecas da Arduino IDE (Autor: Suat Özgür).
 * 
 * Hardware Setup:
 * - Módulo Receptor RF 433MHz (ex: XY-MK-5V, RX470C, SYN480R, etc.):
 *   - VCC -> 5V (ou 3.3V dependendo do modelo do receptor)
 *   - GND -> GND
 *   - DATA (ou OUT) -> ESP32 GPIO 13 (Pino de interrupção padrão definido abaixo)
 * 
 * - Opcional: Botões físicos de backup (GND / INPUT_PULLUP):
 *   - Botão Ponto Time 1: GPIO 12 -> Botão -> GND
 *   - Botão Ponto Time 2: GPIO 14 -> Botão -> GND
 *   - Botão Undo (Desfazer): GPIO 27 -> Botão -> GND
 *   - Botão Reset (Zerar): GPIO 26 -> Botão -> GND
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <RCSwitch.h> // Biblioteca padrão para receptores RF 433MHz

// Instance do receptor RF
RCSwitch mySwitch = RCSwitch();

// ======================= CONFIGURAÇÕES DE REDE E PLACAR =======================
// Substitua com os dados da sua rede WiFi local
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// URL base do seu servidor. 
// - Se estiver usando o AI Studio em desenvolvimento: "https://ais-pre-jiuo4g5yghtpbcenfnzlol-16427151499.us-west1.run.app"
// - Para produção, substitua pelo link público correspondente.
// ATENÇÃO: Nunca coloque a barra "/" no final do link!
const char* hostUrl = "https://ais-pre-jiuo4g5yghtpbcenfnzlol-16427151499.us-west1.run.app";

// O código da partida ativa que você visualiza no navegador (ex: "5379")
const char* matchCode = "5379";


// ======================= MAPEAMENTO DOS CONTROLES REMOTOS RF 433MHz =======================
// COMO CONFIGURAR SEUS CONTROLES:
// 1. Grave este código no ESP32 e abra o "Serial Monitor" a 115200 baudrate.
// 2. Pressione cada um dos 3 botões do Controle 1 (Time 1) e do Controle 2 (Time 2).
// 3. Veja os códigos numéricos (Dec) impressos no monitor Serial.
// 4. Substitua os números abaixo pelos códigos que apareceram nos seus controles!

// CONTROLE REMOTO 1 - TIME 1
const unsigned long RF_TEAM_1_POINT = 1234561; // Substitua pelo código do Botão A (Ponto Time 1)
const unsigned long RF_TEAM_1_UNDO  = 1234562; // Substitua pelo código do Botão B (Voltar Ponto)
const unsigned long RF_TEAM_1_RESET = 1234563; // Substitua pelo código do Botão C (Zerar Partida - opcional)

// CONTROLE REMOTO 2 - TIME 2
const unsigned long RF_TEAM_2_POINT = 9876541; // Substitua pelo código do Botão A (Ponto Time 2)
const unsigned long RF_TEAM_2_UNDO  = 9876542; // Substitua pelo código do Botão B (Voltar Ponto)
const unsigned long RF_TEAM_2_RESET = 9876543; // Substitua pelo código do Botão C (Zerar Partida - opcional)


// ======================= DESIGN DE PINOS DO ESP32 =======================
const int pinRfReceiver = 13; // Pino DATA do receptor RF 433MHz conectado ao ESP32

// Botões físicos opcionais como backup conectado diretamente no ESP32
const int pinButtonTeam1 = 12; // Botão físico Ponto Time 1
const int pinButtonTeam2 = 14; // Botão físico Ponto Time 2
const int pinButtonUndo  = 27; // Botão físico Desfazer
const int pinButtonReset = 26; // Botão físico Zerar

// LED Indicador de Status (geralmente o pino GPIO 2 é o LED interno azul do ESP32)
const int pinLed = 2; 


// ======================= DEBOUNCE E CONTROLE DE CLIQUES =======================
unsigned long lastDebounceTimeTeam1 = 0;
unsigned long lastDebounceTimeTeam2 = 0;
unsigned long lastDebounceTimeUndo  = 0;
unsigned long lastDebounceTimeReset = 0;

unsigned long lastRfReceivedTime = 0;
const unsigned long debounceDelay = 400; // Tempo de retenção em milissegundos para evitar duplicidade de sinal

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==============================================");
  Serial.println("  Padel & Beach Tennis Scoreboard ESP32 & RF  ");
  Serial.println("==============================================");

  // Configuração dos botões físicos de backup com resistor Pull-Up interno
  pinMode(pinButtonTeam1, INPUT_PULLUP);
  pinMode(pinButtonTeam2, INPUT_PULLUP);
  pinMode(pinButtonUndo, INPUT_PULLUP);
  pinMode(pinButtonReset, INPUT_PULLUP);

  // Configuração do LED indicador de status
  pinMode(pinLed, OUTPUT);
  digitalWrite(pinLed, LOW);

  // Inicializa a escuta do receptor RF 433MHz
  // O rc-switch usa número de interrupção ou mapeia para o pino no ESP32
  mySwitch.enableReceive(pinRfReceiver); 
  Serial.print("Receptor RF 433MHz ativado no pino GPIO: ");
  Serial.println(pinRfReceiver);

  // Conecta ao WiFi
  connectToWiFi();
}

void loop() {
  // Mantém a conexão WiFi ativa
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  unsigned long currentMillis = millis();

  // ==================== 1. PROCESSAR SINAIS DO RECEPTOR RF 433MHz ====================
  if (mySwitch.available()) {
    unsigned long receivedValue = mySwitch.getReceivedValue();
    unsigned int bitLength = mySwitch.getReceivedBitlength();
    unsigned int protocol = mySwitch.getReceivedProtocol();

    if (receivedValue == 0) {
      Serial.println("Erro: Sinal de RF recebido com valor inválido ou corrompido.");
    } else {
      // Debounce para o controle remoto (evita disparar múltiplos pontos em um único pressionamento)
      if (currentMillis - lastRfReceivedTime > debounceDelay) {
        lastRfReceivedTime = currentMillis;

        Serial.println("\n-------------------------------------------");
        Serial.print("Sinal RF Detectado | Codigo (Dec): ");
        Serial.print(receivedValue);
        Serial.print(" | Bits: ");
        Serial.print(bitLength);
        Serial.print(" | Protocolo: ");
        Serial.println(protocol);
        Serial.println("-------------------------------------------");

        // Identifica qual botão e qual controle foi pressionado:
        if (receivedValue == RF_TEAM_1_POINT) {
          Serial.println("[RF] Controle Time 1 -> Botão Pontuar! Enviando...");
          sendScoreRequest("/point?team=0");
        } 
        else if (receivedValue == RF_TEAM_2_POINT) {
          Serial.println("[RF] Controle Time 2 -> Botão Pontuar! Enviando...");
          sendScoreRequest("/point?team=1");
        } 
        else if (receivedValue == RF_TEAM_1_UNDO) {
          Serial.println("[RF] Controle Time 1 -> Botão Desfazer! Enviando...");
          sendScoreRequest("/undo");
        } 
        else if (receivedValue == RF_TEAM_2_UNDO) {
          Serial.println("[RF] Controle Time 2 -> Botão Desfazer! Enviando...");
          sendScoreRequest("/undo");
        } 
        else if (receivedValue == RF_TEAM_1_RESET) {
          Serial.println("[RF] Controle Time 1 -> Botão Reset/Zerar! Enviando...");
          sendScoreRequest("/reset");
        } 
        else if (receivedValue == RF_TEAM_2_RESET) {
          Serial.println("[RF] Controle Time 2 -> Botão Reset/Zerar! Enviando...");
          sendScoreRequest("/reset");
        } 
        else {
          Serial.println("[⚠️ INFO] Controle RF pressionado, mas o código não foi configurado acima.");
          Serial.println("Copie o código impresso em 'Codigo (Dec)' e configure nas constantes do topo do arquivo!");
          blinkLed(1, 100); // Pisca curto rápido informando que detectou código estranho
        }
      }
    }
    mySwitch.resetAvailable(); // Prepara o receptor para receber o próximo sinal
  }

  // ==================== 2. PROCESSAR CLIQUES DOS BOTÕES FÍSICOS (OPCIONAL) ====================
  
  // --- Botão Físico: Time 1 Pontuar (GPIO 12) ---
  if (digitalRead(pinButtonTeam1) == LOW) {
    if (currentMillis - lastDebounceTimeTeam1 > debounceDelay) {
      lastDebounceTimeTeam1 = currentMillis;
      Serial.println("\n[Físico] Botão Time 1 acionado!");
      sendScoreRequest("/point?team=0");
    }
  }

  // --- Botão Físico: Time 2 Pontuar (GPIO 14) ---
  if (digitalRead(pinButtonTeam2) == LOW) {
    if (currentMillis - lastDebounceTimeTeam2 > debounceDelay) {
      lastDebounceTimeTeam2 = currentMillis;
      Serial.println("\n[Físico] Botão Time 2 acionado!");
      sendScoreRequest("/point?team=1");
    }
  }

  // --- Botão Físico: Desfazer (GPIO 27) ---
  if (digitalRead(pinButtonUndo) == LOW) {
    if (currentMillis - lastDebounceTimeUndo > debounceDelay) {
      lastDebounceTimeUndo = currentMillis;
      Serial.println("\n[Físico] Botão Desfazer acionado!");
      sendScoreRequest("/undo");
    }
  }

  // --- Botão Físico: Reset/Zerar (GPIO 26) ---
  if (digitalRead(pinButtonReset) == LOW) {
    if (currentMillis - lastDebounceTimeReset > debounceDelay) {
      lastDebounceTimeReset = currentMillis;
      Serial.println("\n[Físico] Botão Reset acionado!");
      sendScoreRequest("/reset");
    }
  }

  delay(10); // Pausa minúscula para estabilidade do loop
}

// ======================= FUNÇÕES AUXILIARES E DE CONEXÃO =======================

void connectToWiFi() {
  Serial.print("Conectando ao WiFi: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    Serial.print(".");
    // Pisca o LED durante a conexão
    digitalWrite(pinLed, !digitalRead(pinLed));
    attempt++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Conectado com Sucesso!");
    Serial.print("IP do ESP32: ");
    Serial.println(WiFi.localIP());
    // LED fica ligado continuamente indicando sucesso na conexão
    digitalWrite(pinLed, HIGH);
  } else {
    Serial.println("\nFalha na conexao WiFi. Tentando novamente no loop...");
    digitalWrite(pinLed, LOW);
  }
}

// Envia a requisição HTTP GET para o servidor Node/React
void sendScoreRequest(String endpoint) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Erro: Não foi possível enviar a requisição, sinal WiFi offline!");
    blinkLed(4, 80); // Pisca sinalizando erro
    return;
  }

  HTTPClient http;

  // Constrói a URL completa. Ex: "https://ais-pre-jiuo4g5yghtpbcenfnzlol-16427151499.us-west1.run.app/api/match/5379/point?team=0"
  String targetUrl = String(hostUrl) + "/api/match/" + String(matchCode) + endpoint;
  
  Serial.print("[HTTP] Enviando comando: ");
  Serial.println(targetUrl);

  // Desliga o LED rapidamente enquanto trafega para feedback visual direto
  digitalWrite(pinLed, LOW);

  http.begin(targetUrl);
  int httpResponseCode = http.GET();

  if (httpResponseCode > 0) {
    Serial.print("[HTTP] Código de resposta do Servidor: ");
    Serial.println(httpResponseCode);
    
    String payload = http.getString();
    Serial.println("[HTTP] Retorno da requisicao:");
    Serial.println(payload);

    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      // Sucesso total
      blinkLed(2, 120);
    } else {
      // Erro no servidor ou parâmetro incorreto
      blinkLed(5, 70);
    }
  } else {
    Serial.print("[HTTP ⚠️ ERRO] Falha na conexao. Codigo: ");
    Serial.println(httpResponseCode);
    blinkLed(4, 90);
  }

  http.end();
  digitalWrite(pinLed, HIGH); // Restabelece LED aceso indicando conectado
}

// Pisca o LED interno de forma personalizada
void blinkLed(int times, int speedMs) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pinLed, HIGH);
    delay(speedMs);
    digitalWrite(pinLed, LOW);
    delay(speedMs);
  }
}
