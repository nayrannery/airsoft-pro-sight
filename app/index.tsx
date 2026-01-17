import { StyleSheet, View, Text, TouchableOpacity, Alert, StatusBar } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceMotion } from 'expo-sensors';
import * as ScreenOrientation from 'expo-screen-orientation';

export default function CameraScreen() {
  const [facing, setFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0);
  const [stabilityScore, setStabilityScore] = useState(1);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const webViewRef = useRef<WebView>(null);

  // Habilita todas as orientações
  useEffect(() => {
    async function unlockOrientation() {
      await ScreenOrientation.unlockAsync();
      console.log('🔓 Orientação desbloqueada - Todas as orientações permitidas');
    }
    unlockOrientation();
  }, []);

  // Ocultar barra de status para tela cheia imersiva
  useEffect(() => {
    StatusBar.setHidden(true);
    return () => StatusBar.setHidden(false);
  }, []);

  // Sistema de estabilidade baseado em TREMOR (variação), não posição absoluta
  useEffect(() => {
    let lastAcceleration = { x: 0, y: 0, z: 0 };
    let stabilityHistory: number[] = [];
    let updateCount = 0;
    let isInitialized = false;

    DeviceMotion.setUpdateInterval(100); // 10 leituras por segundo

    const subscription = DeviceMotion.addListener((data) => {
      updateCount++;
      
      if (updateCount % 20 === 0) {
        console.log(`📡 DeviceMotion ativo - Update #${updateCount}`);
      }
      
      // Tenta usar acceleration, se não disponível usa accelerationIncludingGravity
      let acceleration = data.acceleration || data.accelerationIncludingGravity;
      
      if (acceleration) {
        const { x, y, z } = acceleration;
        
        // Inicialização - ignora primeira leitura
        if (!isInitialized) {
          lastAcceleration = { x: x || 0, y: y || 0, z: z || 0 };
          isInitialized = true;
          return;
        }
        
        // Calcula VARIAÇÃO (tremor) entre leituras em todos os eixos
        const deltaX = Math.abs((x || 0) - lastAcceleration.x);
        const deltaY = Math.abs((y || 0) - lastAcceleration.y);
        const deltaZ = Math.abs((z || 0) - lastAcceleration.z);
        
        // Soma das variações = tremor total
        const tremor = deltaX + deltaY + deltaZ;
        
        // Atualiza última leitura
        lastAcceleration = { x: x || 0, y: y || 0, z: z || 0 };
        
        // Histórico para suavizar (média móvel de 15 leituras = 1.5 segundos)
        // Histórico menor = mais difícil de estabilizar
        stabilityHistory.push(tremor);
        if (stabilityHistory.length > 15) {
          stabilityHistory.shift();
        }
        
        // Média do tremor
        const avgTremor = stabilityHistory.reduce((a, b) => a + b, 0) / stabilityHistory.length;
        
        // Converte tremor para score visível
        // Multiplica por 25 (ajustado para dificuldade moderada)
        // Valores típicos: 0-4 = muito estável, 4-10 = estável, 10-20 = instável, 20+ = muito instável
        const displayScore = avgTremor * 25;
        let score = Math.min(displayScore, 100); // Limita a 100
        
        setStabilityScore(score);
        
        // Log detalhado a cada 50 updates
        if (updateCount % 50 === 0) {
          console.log(`🎯 Estabilidade - Tremor: ${avgTremor.toFixed(3)}, Score: ${score.toFixed(1)}`);
          
          // Log dos valores de rotação para debug
          if (data.rotation) {
            console.log(`📐 Rotation - Beta: ${data.rotation.beta?.toFixed(3)}, Gamma: ${data.rotation.gamma?.toFixed(3)}, Alpha: ${data.rotation.alpha?.toFixed(3)}`);
          }
        }
        
        // Envia para o WebView atualizar a UI
        if (webViewRef.current) {
          // DeviceMotion.rotation retorna valores que podem estar em radianos ou graus
          // dependendo da plataforma. Vamos tentar ambos os formatos.
          
          // Tenta usar rotation (valores em radianos - iOS/Android nativos)
          let pitch = 0;
          let roll = 0;
          
          if (data.rotation) {
            // Converte de radianos para graus
            pitch = data.rotation.beta ? (data.rotation.beta * 180 / Math.PI) : 0;
            roll = data.rotation.gamma ? (data.rotation.gamma * 180 / Math.PI) : 0;
          }
          
          // Se os valores parecerem muito grandes (> 360), provavelmente já estão em graus
          if (Math.abs(pitch) > 360 || Math.abs(roll) > 360) {
            pitch = data.rotation?.beta || 0;
            roll = data.rotation?.gamma || 0;
          }
          
          webViewRef.current.injectJavaScript(`
            if (typeof window.updateStability === 'function') {
              window.updateStability(${score.toFixed(1)});
            }
            if (typeof window.updateOrientation === 'function') {
              window.updateOrientation(${pitch.toFixed(1)}, ${roll.toFixed(1)});
            }
            true;
          `);
        }
      }
    });

    return () => subscription && subscription.remove();
  }, []);

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Carregando câmera...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Precisamos da sua permissão para usar a câmera</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Permitir Câmera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('📨 Mensagem recebida do WebView:', data);
      
      switch (data.type) {
        case 'zoom':
          // Converte 0-1 do slider para 0-1 da câmera
          const zoomValue = Math.max(0, Math.min(1, data.value));
          setZoom(zoomValue);
          console.log(`🔍 Zoom ajustado: ${(data.value * 10).toFixed(1)}x (normalizado: ${zoomValue.toFixed(2)})`);
          break;

        case 'saveProfile':
          try {
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            const profiles = profilesJson ? JSON.parse(profilesJson) : [];
            
            // Recebe o perfil completo do HTML
            const newProfile = data.profile || data;
            
            // Valida se tem nome
            if (!newProfile.name) {
              console.log('⚠️ Salvamento cancelado - sem nome de perfil');
              Alert.alert('❌ Erro', 'Digite um nome para o perfil');
              break;
            }
            
            // Salva o perfil completo com todas as propriedades
            profiles.push(newProfile);
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(profiles));
            Alert.alert('✅ Sucesso', `Perfil "${newProfile.name}" salvo!`);
            console.log('✅ Perfil salvo:', newProfile);
          } catch (error) {
            Alert.alert('❌ Erro', 'Falha ao salvar perfil');
            console.error('Erro ao salvar perfil:', error);
          }
          break;

        case 'loadProfile':
        case 'loadProfiles':
          try {
            console.log('📥 Solicitação de carregar perfis recebida');
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            console.log('📄 JSON do AsyncStorage:', profilesJson);
            const profiles = profilesJson ? JSON.parse(profilesJson) : [];
            console.log('📋 Perfis parseados:', profiles);
            webViewRef.current?.injectJavaScript(`
              console.log('🔄 Injetando perfis no WebView...');
              if (window.receiveProfiles) {
                window.receiveProfiles(${JSON.stringify(profiles)});
              } else {
                console.error('❌ window.receiveProfiles não existe!');
              }
            `);
            console.log('📂 Perfis carregados e enviados ao WebView:', profiles.length);
          } catch (error) {
            Alert.alert('❌ Erro', 'Falha ao carregar perfis');
            console.error('Erro ao carregar perfis:', error);
          }
          break;

        case 'deleteProfile':
          try {
            console.log('🗑️ Solicitação de deletar perfil ID:', data.id);
            const profilesJson = await AsyncStorage.getItem('airsoftProfiles');
            let profiles = profilesJson ? JSON.parse(profilesJson) : [];
            console.log('📋 Perfis antes de deletar:', profiles.length);
            profiles = profiles.filter((p: any) => p.id !== data.id);
            console.log('📋 Perfis após deletar:', profiles.length);
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(profiles));
            console.log('� Perfis salvos no AsyncStorage');
            
            // Retorna a lista atualizada para o HTML
            webViewRef.current?.injectJavaScript(`
              console.log('🔄 Atualizando lista de perfis após exclusão...');
              if (window.receiveProfiles) {
                window.receiveProfiles(${JSON.stringify(profiles)});
              } else {
                console.error('❌ window.receiveProfiles não existe!');
              }
            `);
            console.log('✅ Lista de perfis atualizada no WebView');
          } catch (error) {
            console.error('Erro ao deletar perfil:', error);
          }
          break;

        case 'saveAllProfiles':
          try {
            await AsyncStorage.setItem('airsoftProfiles', JSON.stringify(data.profiles));
            console.log('💾 Todos os perfis salvos (total:', data.profiles.length, ')');
          } catch (error) {
            console.error('Erro ao salvar perfis:', error);
          }
          break;

        case 'takePhoto':
          console.log('📷 Captura de foto solicitada');
          try {
            if (cameraRef.current) {
              const photo = await cameraRef.current.takePictureAsync({
                quality: 0.9,
                base64: false,
              });
              console.log('✅ Foto capturada:', photo.uri);
              Alert.alert('📷 Foto Capturada!', `Salva em: ${photo.uri.split('/').pop()}`);
            }
          } catch (error) {
            console.error('❌ Erro ao capturar foto:', error);
            Alert.alert('❌ Erro', 'Falha ao capturar foto');
          }
          break;

        case 'saveState':
          try {
            await AsyncStorage.setItem('airsoftState', JSON.stringify(data.state));
            console.log('💾 Estado auto-salvo');
          } catch (error) {
            console.error('Erro ao salvar estado:', error);
          }
          break;

        case 'loadState':
          try {
            const stateJson = await AsyncStorage.getItem('airsoftState');
            const state = stateJson ? JSON.parse(stateJson) : null;
            if (state && webViewRef.current) {
              webViewRef.current.injectJavaScript(`
                if (window.applyState) {
                  window.applyState(${JSON.stringify(state)});
                }
              `);
              console.log('📂 Estado restaurado');
            }
          } catch (error) {
            console.error('Erro ao carregar estado:', error);
          }
          break;

        case 'stateChanged':
          console.log('Estado atualizado:', data.state);
          break;

        case 'ready':
        case 'webview_ready':
          console.log('✅ WebView pronto:', data.message || 'Carregado');
          break;

        case 'dpad':
          console.log('🎮 D-Pad pressionado:', data.direction);
          break;

        case 'calibrate':
        case 'tare':
          console.log('🎯 Calibração/Tara solicitada');
          Alert.alert('Calibração', 'Mantenha o dispositivo estável...');
          break;

        default:
          console.log('❓ Mensagem não reconhecida:', data);
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  };

  // Lê o arquivo HTML original completo
  const htmlSource = require('./index.html');

  return (
    <View style={styles.container}>
      {/* Câmera Nativa no fundo */}
      <CameraView 
        ref={cameraRef}
        style={styles.camera} 
        facing={facing}
        zoom={zoom}
      />
      
      {/* Wrapper para WebView com transparência forçada no Android */}
      <View 
        style={styles.webviewWrapper}
        collapsable={false}
        needsOffscreenAlphaCompositing={true}
      >
        {/* WebView com HTML transparente sobreposto */}
        <WebView
          ref={webViewRef}
          source={htmlSource}
          style={styles.webviewOverlay}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          scrollEnabled={false}
          bounces={false}
          onMessage={handleWebViewMessage}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          // Propriedades para transparência no Android
          androidLayerType="hardware"
          // Injeta CSS adicional para garantir transparência
          injectedJavaScript={`
            document.body.style.background = 'transparent';
            document.documentElement.style.background = 'transparent';
            true;
          `}
          onLoad={async () => {
            // Auto-load do último estado salvo
            try {
              const stateJson = await AsyncStorage.getItem('airsoftState');
              const state = stateJson ? JSON.parse(stateJson) : null;
              if (state) {
                setTimeout(() => {
                  webViewRef.current?.injectJavaScript(`
                    if (window.applyState) {
                      window.applyState(${JSON.stringify(state)});
                    }
                  `);
                  console.log('🚀 Estado inicial restaurado');
                }, 500); // Aguarda 500ms para garantir que o HTML carregou
              }
            } catch (e) {
              console.error('❌ Erro ao carregar estado inicial:', e);
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  webviewWrapper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  webviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: 18,
    color: '#0f0',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#0f0',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#0f0',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    marginHorizontal: 20,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },
});
